import test from 'node:test';
import assert from 'node:assert/strict';
import { rebuildCurrentSnapshot } from '../src/core/snapshot-reducer.js';

function event(overrides = {}) {
  return {
    eventId: 'event:' + Math.random().toString(36).slice(2),
    deletedAt: null,
    invalid: false,
    timelineContext: 'main',
    sourceOrder: { messageIndex: 0, evidenceOrder: 0 },
    kind: 'inventory',
    operation: 'add',
    subjectEntityId: 'entity:player',
    value: { name: '茶', ownership: 'owned', quantity: { exact: 1, unit: '包', text: null } },
    ...overrides,
  };
}

test('ledger rebuild keeps player and NPC assets distinct without model dedupe keys', () => {
  const snapshot = rebuildCurrentSnapshot([
    event({ eventId: 'player', value: { name: '玉佩', ownership: 'borrowed', quantity: { exact: 1 } } }),
    event({ eventId: 'npc', subjectEntityId: 'entity:npc:li', value: { name: '玉佩', ownership: 'owned', quantity: { exact: 1 }, dedupeKey: 'player' } }),
    event({ eventId: 'unknown-owner', subjectEntityId: null, value: { name: '劍', quantity: { exact: 1 } } }),
  ]);
  assert.equal(snapshot.assets.length, 2);
  assert.equal(snapshot.assets.filter((asset) => asset.ownerEntityId === snapshot.playerEntityId).length, 1);
  assert.equal(snapshot.assets.find((asset) => asset.ownerEntityId === 'entity:player').ownership, 'borrowed');
});

test('quantities and generic containers are preserved without guessing', () => {
  const snapshot = rebuildCurrentSnapshot([event({ value: { name: '糕點', ownership: 'gifted', quantity: { exact: null, text: '一些', unit: '盒' } } })]);
  const asset = snapshot.assets[0];
  assert.deepEqual(asset.quantity, { exact: null, text: '一些', unit: '盒', isExact: false });
  assert.equal(asset.container.type, 'carried');
  assert.equal(asset.current, true);
});

test('ordered acquire and consume retains a zero-current ledger asset', () => {
  const snapshot = rebuildCurrentSnapshot([
    event({ eventId: 'get', sourceOrder: { messageIndex: 1, evidenceOrder: 0 }, value: { name: '酒', ownership: 'owned', quantity: { exact: 1, unit: '杯' } } }),
    event({ eventId: 'drink', sourceOrder: { messageIndex: 1, evidenceOrder: 1 }, operation: 'consume', value: { name: '酒', ownership: 'owned', quantity: { exact: 1, unit: '杯' } } }),
  ]);
  assert.equal(snapshot.assets.length, 1);
  assert.equal(snapshot.assets[0].quantity.exact, 0);
  assert.equal(snapshot.assets[0].current, false);
  assert.equal(snapshot.assets[0].sourceEventId, 'drink');
});

test('currency, entity status, and directional relationship reduce independently', () => {
  const snapshot = rebuildCurrentSnapshot([
    event({ kind: 'currency', value: { name: '銀兩', amount: 12, unit: '兩' } }),
    event({ kind: 'currency', operation: 'subtract', value: { name: '銀兩', amount: 2, unit: '兩' } }),
    event({ kind: 'person_state', subjectEntityId: 'entity:npc:li', value: { status: '受傷', stateType: 'durable' } }),
    event({ kind: 'relationship', subjectEntityId: 'entity:player', value: { targetEntityId: 'entity:npc:li', dimension: 'trust', trend: 'up', value: '信任' } }),
  ]);
  assert.equal(snapshot.currencies[0].amount, 10);
  assert.equal(snapshot.entities['entity:npc:li'].durableStatuses[0].label, '受傷');
  assert.ok(snapshot.relationships['entity:player|entity:npc:li|trust']);
  assert.equal(snapshot.relationships['entity:npc:li|entity:player|trust'], undefined);
});

test('non-main, deleted, and invalid events never alter the rebuilt current snapshot', () => {
  const snapshot = rebuildCurrentSnapshot([
    event({ eventId: 'main', value: { name: '主線物品', ownership: 'owned', quantity: { exact: 1 } } }),
    event({ eventId: 'memory', timelineContext: 'memory', value: { name: '回憶物品', ownership: 'owned', quantity: { exact: 1 } } }),
    event({ eventId: 'deleted', deletedAt: '2026-01-01T00:00:00.000Z', value: { name: '刪除物品', ownership: 'owned', quantity: { exact: 1 } } }),
    event({ eventId: 'invalid', invalid: true, value: { name: '非法物品', ownership: 'owned', quantity: { exact: 1 } } }),
  ]);
  assert.deepEqual(snapshot.assets.map((asset) => asset.canonicalName), ['主線物品']);
  assert.deepEqual(snapshot.sourceEventIds, ['main']);
});

test('rebuild is deterministic and uses structured source order', () => {
  const events = [
    event({ eventId: 'late', sourceOrder: { messageIndex: 2, evidenceOrder: 0 }, kind: 'story_time', value: { time: '申時' } }),
    event({ eventId: 'early', sourceOrder: { messageIndex: 1, evidenceOrder: 1000 }, kind: 'story_time', value: { time: '午時' } }),
  ];
  const first = rebuildCurrentSnapshot(events, '2026-01-01T00:00:00.000Z');
  const second = rebuildCurrentSnapshot(events, '2026-01-01T00:00:00.000Z');
  assert.equal(first.currentTime, '申時');
  assert.deepEqual(first, second);
});