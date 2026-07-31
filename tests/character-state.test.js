import test from 'node:test';
import assert from 'node:assert/strict';
import { createCharacterState, rebuildCharacterState } from '../src/core/character-state.js';
import { CHAT_STATE_SCHEMA_VERSION, createChatState, migrateChatState } from '../src/core/chat-state.js';

const at = '2026-07-30T00:00:00.000Z';
function event(overrides) { return { schemaVersion: 2, eventId: `event-${overrides.storyOrder}`, batchId: 'batch', deletedAt: null, createdAt: at, timelineContext: 'main', operation: 'set', value: {}, ...overrides }; }

test('V4 keeps one latest mainline time and preserves earlier times as history', () => {
  const state = rebuildCharacterState([
    event({ kind: 'story_time', storyOrder: 1, value: { time: '三月十七' } }),
    event({ kind: 'story_time', storyOrder: 2, value: { time: '三月十九' } }),
    event({ kind: 'story_time', storyOrder: 3, value: { time: '三月廿一' } }),
    event({ kind: 'story_time', storyOrder: 4, timelineContext: 'memory', value: { time: '二月初一' } }),
  ]);
  assert.equal(state.story.currentTime, '三月廿一');
  assert.equal(state.story.timelineHistory.length, 4);
});

test('player inventory only includes explicitly player-owned mainline assets', () => {
  const state = rebuildCharacterState([
    event({ kind: 'inventory', operation: 'add', storyOrder: 1, subjectEntityId: 'entity:player', value: { name: '桂花糕', quantity: 2 } }),
    event({ kind: 'inventory', operation: 'subtract', storyOrder: 2, subjectEntityId: 'entity:player', value: { name: '桂花糕', quantity: 1 } }),
    event({ kind: 'inventory', operation: 'add', storyOrder: 3, subjectEntityId: 'entity:npc:mo', value: { name: '長劍', quantity: 1 } }),
  ]);
  assert.deepEqual(state.inventory.items.map(({ name, quantity }) => ({ name, quantity })), [{ name: '桂花糕', quantity: 1 }]);
});

test('entities retain one current location and transient state', () => {
  const state = rebuildCharacterState([
    event({ kind: 'person', operation: 'update', storyOrder: 1, subjectEntityId: 'entity:npc:mo', value: { canonicalName: '墨錚', location: '房中', status: '驚訝', transient: true } }),
    event({ kind: 'person', operation: 'update', storyOrder: 2, subjectEntityId: 'entity:npc:mo', value: { canonicalName: '墨錚', location: '郡主面前', status: '平靜', transient: true } }),
  ]);
  const mo = state.entities.byId['entity:npc:mo'];
  assert.equal(mo.currentLocation, '郡主面前');
  assert.equal(mo.transientState.value, '平靜');
});

test('mainline player place updates the current place while NPC movement does not', () => {
  const state = rebuildCharacterState([
    event({ kind: 'place', storyOrder: 1, subjectEntityId: 'entity:npc:mo', value: { name: 'garden', canonicalName: 'Mo' } }),
    event({ kind: 'place', storyOrder: 2, subjectEntityId: 'entity:player', value: { name: 'library' } }),
    event({ kind: 'place', storyOrder: 3, timelineContext: 'dream', subjectEntityId: 'entity:player', value: { name: 'dream room' } }),
  ]);
  assert.equal(state.entities.byId['entity:npc:mo'].currentLocation, 'garden');
  assert.equal(state.story.currentScenePlace, 'library');
});

test('V3 safely migrates to V4 and future state remains protected', () => {
  const v3 = createChatState(at); v3.schemaVersion = 3; delete v3.historyImportProgress; v3.character.schemaVersion = 1;
  const migrated = migrateChatState(v3, at);
  assert.equal(migrated.state.schemaVersion, CHAT_STATE_SCHEMA_VERSION);
  assert.equal(migrated.state.historyImportProgress.pipelineVersion, 2);
  assert.throws(() => migrateChatState({ schemaVersion: 6 }, at), /future schemaVersion/);
  assert.equal(createCharacterState().schemaVersion, 2);
});
