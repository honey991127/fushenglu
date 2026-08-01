import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatState } from '../src/core/chat-state.js';
import { confirmWorldRule, deleteWorldRule, editWorldRule, rejectWorldRule, suggestWorldRule } from '../src/core/world-rules.js';
const stamp = '2026-08-01T00:00:00.000Z';
test('world rule suggestion is deduped and rejected keys are not suggested again', () => {
  let state = suggestWorldRule(createChatState(stamp), { ruleKey: 'currency-tier', type: '貨幣', description: '品級分開記錄' }, stamp);
  state = rejectWorldRule(state, 'currency-tier', stamp); const duplicate = suggestWorldRule(state, { ruleKey: 'currency-tier', type: '貨幣', description: '改寫' }, stamp);
  assert.equal(duplicate.worldRules.entries.length, 1); assert.equal(duplicate.worldRules.entries[0].status, 'rejected');
});
test('confirm edit delete preserve event ledger', () => {
  let state = createChatState(stamp); state.events = [{ eventId: 'event:kept', schemaVersion: 1, kind: 'story_time', operation: 'set', value: { time: '今日' }, sourceMessageRefs: [], deletedAt: null, updatedAt: stamp }];
  state = suggestWorldRule(state, { ruleKey: 'place', type: '地點', description: '地點需明示' }, stamp); state = confirmWorldRule(state, 'place', stamp); state = editWorldRule(state, 'place', '地點必須明示', stamp); const removed = deleteWorldRule(state, 'place', stamp);
  assert.equal(removed.worldRules.entries.length, 0); assert.equal(removed.events[0].eventId, 'event:kept');
});
test('world rules reject empty or overlong input', () => {
  assert.throws(() => suggestWorldRule(createChatState(stamp), { ruleKey: ' ', description: 'x' }, stamp));
  assert.throws(() => suggestWorldRule(createChatState(stamp), { ruleKey: 'x', description: 'x'.repeat(501) }, stamp));
});
