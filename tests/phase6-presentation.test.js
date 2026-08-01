import test from 'node:test';
import assert from 'node:assert/strict';
import { formatReviewItem, homeModel, pendingOptions, pendingQuestion, quantityText, reviewSummary } from '../src/ui/presentation.js';

test('Phase 6 home reads only one current snapshot time and place', () => {
  const view = homeModel({ currentSnapshot: { playerEntityId: 'entity:player', currentTime: '三月十八申時', currentPlace: '山門', assets: [], currencies: [], entities: {} }, pendingItems: [{ status: 'accepted' }, { status: 'pending' }], batches: [] });
  assert.equal(view.time, '三月十八申時'); assert.equal(view.place, '山門'); assert.equal(view.pending, 1);
});
test('safe review excludes pending and needs one total confirmation summary', () => {
  const summary = reviewSummary({ detectedChanges: [{ kind: 'inventory', policyDisposition: 'apply' }, { kind: 'place', policyDisposition: 'pending' }], uncertainItems: [{ kind: 'inventory', policyDisposition: 'pending' }] });
  assert.equal(summary.total, 1); assert.equal(summary.counts.inventory, 1);
});
test('human formatter does not expose technical keys and preserves quantity text', () => {
  const card = formatReviewItem({ kind: 'inventory', operation: 'acquire', value: { name: '<糕點>', ownership: 'borrowed', quantity: { exact: null, text: '一些' }, container: { type: 'room' } } });
  assert.match(card.text, /一些/); assert.doesNotMatch(card.text, /factKey|eventId|schemaVersion/); assert.equal(quantityText({}), '數量未記錄');
});
test('home excludes NPC, closed assets, and room storage from carried', () => {
  const view = homeModel({ currentSnapshot: { playerEntityId: 'entity:player', assets: [ { current: true, ownerEntityId: 'entity:npc', canonicalName: 'NPC物', container: { type: 'carried' } }, { current: false, ownerEntityId: 'entity:player', canonicalName: '失去物', container: { type: 'carried' } }, { current: true, ownerEntityId: 'entity:player', canonicalName: '箱內物', container: { type: 'room' } } ], currencies: [], entities: {} }, pendingItems: [], batches: [] });
  assert.equal(view.carried.length, 0); assert.equal(view.stored[0].canonicalName, '箱內物');
});
test('pending questions have natural options without editable JSON', () => {
  const item = { reasonCode: 'ownership', proposal: { value: { name: '信' } } };
  assert.match(pendingQuestion(item), /永久送給玩家/); assert.deepEqual(pendingOptions(item).map((x) => x[0]), ['accepted', 'edited', 'rejected']);
});
