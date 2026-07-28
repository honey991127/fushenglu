import test from 'node:test';
import assert from 'node:assert/strict';

import { createCharacterAction } from '../src/core/character-state.js';
import { createChatState, migrateChatState } from '../src/core/chat-state.js';
import {
  addDraftAction,
  beginTurnBatch,
  buildHandoffInjection,
  commitBatch,
  completeBatch,
  completeBatchAnalysis,
  prepareBatchHandoff,
  resolvePendingItem,
  startBatchCommit,
  undoLatestCommittedBatch,
} from '../src/core/turn-sync.js';
import { createEmptyAnalysisResult } from '../src/core/analysis-schema.js';

const NOW = '2026-07-29T00:00:00.000Z';
const LATER = '2026-07-29T00:01:00.000Z';

function ids() {
  let count = 0;
  return (prefix) => `${prefix}-${++count}`;
}

function action(kind, operation, value, name = `${kind}-${operation}`) {
  return createCharacterAction({
    actionId: `action-${name}`,
    kind,
    operation,
    value,
    dedupeKey: `dedupe-${name}-${JSON.stringify(value)}`,
    timestamp: NOW,
  });
}

function reviewAction(state, batchId, characterAction) {
  let next = addDraftAction(state, characterAction, NOW);
  next = beginTurnBatch(next, [], { batchId, timestamp: NOW, source: 'plugin_operation' }).state;
  return completeBatchAnalysis(next, batchId, createEmptyAnalysisResult(), NOW);
}

function confirm(state, batchId) {
  const createId = ids();
  let next = startBatchCommit(state, batchId, NOW);
  next = commitBatch(next, batchId, { timestamp: NOW, createId });
  next = prepareBatchHandoff(next, batchId, { timestamp: NOW, createId });
  return completeBatch(next, batchId, NOW);
}

test('different chats keep inventory, wardrobe, skills, and cultivation isolated', () => {
  let chatA = createChatState(NOW);
  const chatB = createChatState(NOW);
  chatA = confirm(chatA = reviewAction(chatA, 'batch-a', action('currency', 'add', { name: '靈石', amount: 12 }, 'stone')), 'batch-a');

  assert.equal(chatA.character.inventory.currencies[0].amount, 12);
  assert.deepEqual(chatB.character.inventory.currencies, []);
  assert.deepEqual(chatB.character.wardrobe.garments, []);
  assert.deepEqual(chatB.character.skills.entries, []);
  assert.deepEqual(chatB.character.cultivation.milestones, []);
});

test('items and currencies cannot become negative', () => {
  let state = createChatState(NOW);
  state = confirm(state = reviewAction(state, 'batch-add', action('inventory', 'add', { name: '藥草', quantity: 1, category: '材料' }, 'herb-add')), 'batch-add');
  state = reviewAction(state, 'batch-subtract', action('inventory', 'subtract', { name: '藥草', quantity: 2, category: '材料' }, 'herb-subtract'));
  state = startBatchCommit(state, 'batch-subtract', NOW);

  assert.throws(() => commitBatch(state, 'batch-subtract', { timestamp: NOW, createId: ids() }), /cannot be below zero/);
});

test('outfit changes do not apply before final confirmation and owned garments may be worn', () => {
  let state = createChatState(NOW);
  state = confirm(state = reviewAction(state, 'batch-garment', action('wardrobe', 'add', { name: '青衫', part: '上衣', ownershipStatus: 'owned' }, 'robe')), 'batch-garment');
  state = reviewAction(state, 'batch-wear', action('wardrobe', 'wear', { name: '行旅裝', garments: ['青衫'] }, 'wear'));

  assert.equal(state.character.wardrobe.currentOutfit, null);
  state = confirm(state, 'batch-wear');
  assert.deepEqual(state.character.wardrobe.currentOutfit.garmentNames, ['青衫']);
});

test('unclear, borrowed, temporary, and gifted garments enter pending review', () => {
  let state = createChatState(NOW);
  state = reviewAction(state, 'batch-borrowed', action('wardrobe', 'add', { name: '外借披風', part: '外袍', ownershipStatus: 'borrowed' }, 'borrowed'));
  state = confirm(state, 'batch-borrowed');

  assert.equal(state.pendingItems.length, 1);
  assert.equal(state.pendingItems[0].kind, 'wardrobe');
  assert.deepEqual(state.character.wardrobe.garments, []);
});

test('skill proficiency never automatically declines', () => {
  let state = createChatState(NOW);
  state = reviewAction(state, 'batch-skill-new', action('skill', 'set', { name: '劍術', category: '武技', proficiency: 8 }, 'skill-new'));
  state = confirm(state, 'batch-skill-new');
  const pending = state.pendingItems[0];
  state = resolvePendingItem(state, pending.pendingId, 'accepted', { batchId: 'batch-skill-confirm', timestamp: LATER, createId: ids() });
  assert.equal(state.character.skills.entries[0].proficiency, 8);

  state = reviewAction(state, 'batch-skill-down', action('skill', 'set', { name: '劍術', category: '武技', proficiency: 3 }, 'skill-down'));
  state = startBatchCommit(state, 'batch-skill-down', LATER);
  assert.throws(() => commitBatch(state, 'batch-skill-down', { timestamp: LATER, createId: ids() }), /cannot automatically decline/);
});

test('cultivation milestones are separate from skills and require confirmation', () => {
  let state = createChatState(NOW);
  state = reviewAction(state, 'batch-cultivation', action('cultivation', 'confirm_milestone', { stage: '築基', progressDescription: '穩固根基' }, 'cultivation-only'));
  state = confirm(state, 'batch-cultivation');
  assert.equal(state.character.cultivation.current, null);
  const cultivationPending = state.pendingItems[0];
  state = resolvePendingItem(state, cultivationPending.pendingId, 'accepted', { batchId: 'batch-cultivation-confirm', timestamp: LATER, createId: ids() });

  assert.equal(state.character.cultivation.current.stage, '築基');
  assert.deepEqual(state.character.skills.entries, []);
});

test('batch submission is idempotent, undo rebuilds the prior character state, and handoff excludes pending content', () => {
  let state = createChatState(NOW);
  state = reviewAction(state, 'batch-stone', action('currency', 'add', { name: '靈石', amount: 5 }, 'handoff-stone'));
  state = startBatchCommit(state, 'batch-stone', NOW);
  state = commitBatch(state, 'batch-stone', { timestamp: NOW, createId: ids() });
  const once = commitBatch(state, 'batch-stone', { timestamp: LATER, createId: ids() });
  assert.equal(once.events.length, 1);
  state = prepareBatchHandoff(once, 'batch-stone', { timestamp: NOW, createId: ids() });
  state = completeBatch(state, 'batch-stone', NOW);
  assert.match(buildHandoffInjection(state).text, /靈石/);

  state = reviewAction(state, 'batch-pending-cultivation', action('cultivation', 'confirm_milestone', { stage: '金丹' }, 'pending-cultivation'));
  state = confirm(state, 'batch-pending-cultivation');
  assert.doesNotMatch(buildHandoffInjection(state).text, /金丹/);

  state = undoLatestCommittedBatch(state, { batchId: 'batch-undo', timestamp: LATER });
  assert.deepEqual(state.character.inventory.currencies, []);
});

test('V2 chat data migrates to V3 without loss and unknown future versions are rejected', () => {
  const v2 = createChatState(NOW);
  v2.schemaVersion = 2;
  delete v2.character;
  const migrated = migrateChatState(v2, LATER);

  assert.equal(migrated.migrated, true);
  assert.equal(migrated.fromVersion, 2);
  assert.equal(migrated.state.schemaVersion, 3);
  assert.equal(migrated.state.character.schemaVersion, 1);
  assert.throws(() => migrateChatState({ schemaVersion: 4 }, LATER), /停止覆寫/);
});
