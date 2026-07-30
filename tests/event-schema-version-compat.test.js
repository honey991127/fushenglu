import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createChatState,
  validateChatState,
} from '../src/core/chat-state.js';

const NOW = '2026-07-30T12:00:00.000Z';

function makeEvent(schemaVersion, eventId, storyOrder = 0) {
  return {
    schemaVersion,
    eventId,
    batchId: 'batch-event-version',
    sourceType: 'analysis',
    sourceProposalId: null,
    sourceActionId: null,
    sourceMessageRefs: ['message:1'],
    sourceMessageRef: 'message:1',
    sourceMessageIndex: 0,
    storyOrder,
    evidenceQuote: '時間向後推進。',
    timelineContext: 'main',
    subjectEntityId: null,
    factKey: 'story:current-time',
    kind: 'story_time',
    operation: 'advance_time',
    value: { time: '大曆十二年三月十七 亥時初刻' },
    dedupeKey: `message:1:story:current-time:${eventId}`,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  };
}

test('v4 可同時讀取 v1 與 v2 events', () => {
  const state = createChatState(NOW);
  state.events = [
    makeEvent(1, 'event-v1', 0),
    makeEvent(2, 'event-v2', 1000),
  ];
  const result = validateChatState(state, NOW);
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].schemaVersion, 1);
  assert.equal(result.events[1].schemaVersion, 2);
});

test('第十筆 v2 event 不再觸發 events[9] 版本無效', () => {
  const state = createChatState(NOW);
  state.events = Array.from({ length: 10 }, (_, index) =>
    makeEvent(index === 9 ? 2 : 1, `event-${index}`, index * 1000),
  );
  assert.doesNotThrow(() => validateChatState(state, NOW));
});

test('未知 event schemaVersion 仍會拒絕', () => {
  const state = createChatState(NOW);
  state.events = [makeEvent(3, 'event-future')];
  assert.throws(
    () => validateChatState(state, NOW),
    /events\[0\] 版本無效/,
  );
});