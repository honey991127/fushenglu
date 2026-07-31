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
test('asset operations move, transfer, return, remove, set, and clear preserve ledger semantics', () => {
  const events = [
    event({ eventId: 'acquire', operation: 'acquire', sourceOrder: { messageIndex: 1, evidenceOrder: 0 }, value: { name: '��', ownership: 'borrowed', quantity: { exact: 2, unit: '�U' } } }),
    event({ eventId: 'move', operation: 'move', sourceOrder: { messageIndex: 1, evidenceOrder: 1 }, value: { name: '��', container: { type: 'room', display: '�c�l' } } }),
    event({ eventId: 'transfer', operation: 'transfer', sourceOrder: { messageIndex: 1, evidenceOrder: 2 }, value: { name: '��', targetOwnerEntityId: 'entity:npc:li' } }),
  ];
  let snapshot = rebuildCurrentSnapshot(events);
  assert.equal(snapshot.assets.filter((asset) => asset.current && asset.ownerEntityId === 'entity:player').length, 0);
  assert.equal(snapshot.assets.filter((asset) => asset.current && asset.ownerEntityId === 'entity:npc:li').length, 1);
  assert.equal(snapshot.assets.find((asset) => asset.current).container.type, 'room');
  assert.equal(snapshot.assets.find((asset) => asset.current).ownership, 'borrowed');
  snapshot = rebuildCurrentSnapshot(events.map((item) => item.eventId === 'transfer' ? { ...item, deletedAt: '2026-01-01T00:00:00.000Z' } : item));
  assert.equal(snapshot.assets.find((asset) => asset.current).ownerEntityId, 'entity:player');
  assert.equal(snapshot.assets.find((asset) => asset.current).container.type, 'room');
  const returned = rebuildCurrentSnapshot([...events.slice(0, 2), event({ eventId: 'return', operation: 'return', sourceOrder: { messageIndex: 2, evidenceOrder: 0 }, value: { name: '��' } })]);
  assert.equal(returned.assets.some((asset) => asset.current), false);
  for (const operation of ['discard', 'lose', 'destroy', 'clear']) {
    const removed = rebuildCurrentSnapshot([events[0], event({ eventId: operation, operation, sourceOrder: { messageIndex: 2, evidenceOrder: 0 }, value: { name: '��' } })]);
    assert.equal(removed.assets.some((asset) => asset.current), false, operation);
  }
  const set = rebuildCurrentSnapshot([events[0], event({ eventId: 'set', operation: 'set', sourceOrder: { messageIndex: 3, evidenceOrder: 0 }, value: { name: '��', ownership: 'borrowed', quantity: { exact: 5, unit: '�U' } } })]);
  assert.equal(set.assets.find((asset) => asset.current).quantity.exact, 5);
});

test('ownership, container, and currency identity never infer player ownership or world aliases', () => {
  const snapshot = rebuildCurrentSnapshot([
    event({ eventId: 'room-owned', value: { name: '�C', ownership: 'owned', container: { type: 'room', display: '�c�l' }, quantity: { exact: 1 } } }),
    event({ eventId: 'custody', value: { name: '�L', ownership: 'custody', quantity: { exact: 1 } } }),
    event({ eventId: 'temporary', value: { name: '��', ownership: 'temporary', quantity: { exact: 1 } } }),
    event({ eventId: 'top', kind: 'currency', value: { name: '�F��', tier: '�W�~', amount: 1, unit: '�T' } }),
    event({ eventId: 'bottom', kind: 'currency', value: { name: '�F��', tier: '�U�~', amount: 1, unit: '�T' } }),
    event({ eventId: 'note', kind: 'currency', value: { name: '�Ȳ�', amount: 1, unit: '�i' } }),
    event({ eventId: 'silver', kind: 'currency', value: { name: '�Ȩ�', amount: 1, unit: '��' } }),
    event({ eventId: 'no-owner', subjectEntityId: null, kind: 'currency', value: { name: '��', amount: 1 } }),
  ]);
  assert.equal(snapshot.assets.find((asset) => asset.canonicalName === '�C').container.type, 'room');
  assert.deepEqual(snapshot.assets.map((asset) => asset.ownership).sort(), ['custody', 'owned', 'temporary']);
  assert.equal(snapshot.currencies.length, 4);
  assert.equal(snapshot.currencies.some((currency) => currency.name === '��'), false);
});

test('durable and transient state use local keys and latest source order', () => {
  const events = [
    event({ eventId: 'hurt', kind: 'person_state', subjectEntityId: 'entity:npc:li', sourceOrder: { messageIndex: 1, evidenceOrder: 0 }, value: { status: '����' } }),
    event({ eventId: 'surprised', kind: 'person_state', subjectEntityId: 'entity:npc:li', sourceOrder: { messageIndex: 1, evidenceOrder: 1 }, value: { status: '��Y', transient: true, dimension: 'mood' } }),
    event({ eventId: 'calm', kind: 'person_state', subjectEntityId: 'entity:npc:li', sourceOrder: { messageIndex: 2, evidenceOrder: 0 }, value: { status: '���R', transient: true, dimension: 'mood' } }),
    event({ eventId: 'heal', kind: 'person_state', operation: 'resolve', subjectEntityId: 'entity:npc:li', sourceOrder: { messageIndex: 3, evidenceOrder: 0 }, value: { status: '����' } }),
  ];
  const resolved = rebuildCurrentSnapshot(events).entities['entity:npc:li'];
  assert.equal(resolved.durableStatuses.length, 0);
  assert.equal(resolved.durableStatusHistory[0].state, 'resolved');
  assert.equal(resolved.transientStates.mood.label, '���R');
  const restored = rebuildCurrentSnapshot(events.map((item) => item.eventId === 'heal' ? { ...item, deletedAt: '2026-01-01T00:00:00.000Z' } : item)).entities['entity:npc:li'];
  assert.equal(restored.durableStatuses[0].state, 'active');
  assert.match(restored.durableStatuses[0].statusKey, /^entity:npc:li:/);
});
