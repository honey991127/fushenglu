import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHAT_STATE_SCHEMA_VERSION,
  ChatStateMigrationError,
  createChatState,
  migrateChatState,
  rebuildChatStateSnapshot,
  resetCurrentChatData,
} from '../src/core/chat-state.js';

const NOW = '2026-07-31T00:00:00.000Z';

function event(overrides = {}) {
  return {
    schemaVersion: 2,
    eventId: 'event-' + (overrides.storyOrder ?? '1'),
    batchId: 'batch-1',
    kind: 'inventory',
    operation: 'add',
    value: { name: 'tea', quantity: 1 },
    subjectEntityId: 'entity:player',
    timelineContext: 'main',
    sourceMessageRefs: [],
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

test('V5 creates world, decision, ledger, entity, relationship, and current snapshot roots', () => {
  const state = createChatState(NOW);
  assert.equal(state.schemaVersion, 5);
  assert.equal(state.worldRules.schemaVersion, 1);
  assert.deepEqual(state.pendingDecisionRecords, []);
  assert.equal(state.eventLedger.schemaVersion, 1);
  assert.equal(state.entities.schemaVersion, 1);
  assert.equal(state.relationships.schemaVersion, 1);
  assert.equal(state.currentSnapshot.schemaVersion, 1);
  assert.deepEqual(state.historyImportProgress.completedChunkIndexes, []);
});

test('V4 migrates to V5 without guessing missing inventory ownership', () => {
  const v4 = createChatState(NOW);
  v4.schemaVersion = 4;
  delete v4.worldRules;
  delete v4.entities;
  delete v4.relationships;
  delete v4.currentSnapshot;
  delete v4.eventLedger;
  delete v4.pendingDecisionRecords;
  v4.events = [event({ subjectEntityId: null, value: { name: 'unowned', quantity: 1 } })];
  const migrated = migrateChatState(v4, NOW);
  assert.equal(migrated.migrated, true);
  assert.equal(migrated.fromVersion, 4);
  assert.equal(migrated.state.schemaVersion, CHAT_STATE_SCHEMA_VERSION);
  assert.deepEqual(migrated.state.character.inventory.items, []);
  assert.deepEqual(migrated.state.currentSnapshot.character.inventory.items, []);
  assert.deepEqual(migrated.state.eventLedger.eventIds, ['event-1']);
  assert.deepEqual(migrated.state.pendingDecisionRecords, []);
});

test('V5 rejects unknown future and malformed/polluted root data instead of guessing repairs', () => {
  assert.throws(() => migrateChatState({ schemaVersion: 6 }, NOW), ChatStateMigrationError);
  const state = createChatState(NOW);
  state.entities = { schemaVersion: 1, byId: { 'entity:player': { schemaVersion: 1, entityId: 'not-player' } }, playerEntityId: 'entity:player' };
  assert.throws(() => migrateChatState(state, NOW), /entities.byId format invalid/);
});

test('snapshot rebuild preserves soft deletion and excludes owner-less inventory', () => {
  const state = createChatState(NOW);
  state.events = [
    event({ eventId: 'owned', storyOrder: 1, value: { name: 'owned', quantity: 1 } }),
    event({ eventId: 'missing-owner', storyOrder: 2, subjectEntityId: null, value: { name: 'unknown-owner', quantity: 1 } }),
    event({ eventId: 'soft-deleted', storyOrder: 3, deletedAt: NOW, value: { name: 'deleted', quantity: 1 } }),
  ];
  const rebuilt = rebuildChatStateSnapshot(state, NOW);
  assert.deepEqual(rebuilt.character.inventory.items.map((item) => item.name), ['owned']);
  assert.deepEqual(rebuilt.currentSnapshot.sourceEventIds, ['owned', 'missing-owner']);
  assert.deepEqual(rebuilt.eventLedger.deletedEventIds, ['soft-deleted']);
});

test('resetCurrentChatData clears chat state and can preserve only world rules', () => {
  const state = createChatState(NOW);
  state.worldRules.entries.push({ schemaVersion: 1, ruleId: 'rule-1' });
  state.batches.push({ schemaVersion: 1, batchId: 'batch-1', status: 'draft' });
  state.events.push(event());
  state.pendingItems.push({ schemaVersion: 1, pendingId: 'pending-1' });
  state.handoffItems.push({ schemaVersion: 1, handoffId: 'handoff-1' });
  state.historyImportProgress.completedChunkIndexes.push(0);
  state.pendingDecisionRecords.push({ schemaVersion: 1, decisionId: 'decision-1' });
  const reset = resetCurrentChatData(state, { timestamp: NOW });
  assert.deepEqual(reset.batches, []);
  assert.deepEqual(reset.events, []);
  assert.deepEqual(reset.pendingItems, []);
  assert.deepEqual(reset.handoffItems, []);
  assert.deepEqual(reset.historyImportProgress.completedChunkIndexes, []);
  assert.deepEqual(reset.pendingDecisionRecords, []);
  assert.deepEqual(reset.currentSnapshot.sourceEventIds, []);
  assert.deepEqual(reset.entities.byId, {});
  assert.equal(reset.worldRules.entries.length, 1);
  const resetWithoutRules = resetCurrentChatData(state, { timestamp: NOW, preserveWorldRules: false });
  assert.deepEqual(resetWithoutRules.worldRules.entries, []);
});
