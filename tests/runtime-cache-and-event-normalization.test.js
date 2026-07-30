import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createChatState,
  validateChatState,
} from '../src/core/chat-state.js';

const NOW = '2026-07-30T12:00:00.000Z';

function makeEvent({ schemaVersion, includeVersion = true, eventId }) {
  const event = {
    eventId,
    batchId: 'batch-runtime-cache',
    sourceType: 'analysis',
    sourceProposalId: null,
    sourceActionId: null,
    sourceMessageRefs: ['message:1'],
    sourceMessageRef: 'message:1',
    sourceMessageIndex: 0,
    storyOrder: 0,
    evidenceQuote: '時間向後推進。',
    timelineContext: 'main',
    subjectEntityId: null,
    factKey: 'story:current-time',
    kind: 'story_time',
    operation: 'advance_time',
    value: { time: '大曆十二年三月十七 亥時初刻' },
    dedupeKey: `message:1:${eventId}`,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  };

  if (includeVersion) {
    event.schemaVersion = schemaVersion;
  }

  return event;
}

test('events 可讀取 v1、v2 與缺少版本的可辨識舊事件', () => {
  const state = createChatState(NOW);
  state.events = [
    makeEvent({ schemaVersion: 1, eventId: 'event-v1' }),
    makeEvent({ schemaVersion: 2, eventId: 'event-v2' }),
    makeEvent({
      includeVersion: false,
      eventId: 'event-missing-version',
    }),
  ];

  const result = validateChatState(state, NOW);

  assert.deepEqual(
    result.events.map((event) => event.schemaVersion),
    [1, 2, 1],
  );
});

test('未知 event 版本顯示實際收到的版本', () => {
  const state = createChatState(NOW);
  state.events = [
    makeEvent({ schemaVersion: 7, eventId: 'event-v7' }),
  ];

  assert.throws(
    () => validateChatState(state, NOW),
    /收到 7；支援 1、2/,
  );
});

test('manifest 使用 v0.4.2 全新入口', async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL('../manifest.json', import.meta.url),
      'utf8',
    ),
  );
  const entry = await readFile(
    new URL(`../${manifest.js}`, import.meta.url),
    'utf8',
  );

  assert.equal(manifest.version, '0.4.2');
  assert.equal(manifest.js, 'src/index.v042.js');
  assert.match(entry, /\.v042\.js/);
});

test('API 頁顯示生成的 runtime 版本', async () => {
  const source = await readFile(
    new URL('../src/ui/app.js', import.meta.url),
    'utf8',
  );

  assert.match(source, /from '\.\.\/generated\/version\.v042\.js';/);
  assert.doesNotMatch(source, /const APP_VERSION\s*=/);
  assert.match(source, /v\$\{APP_VERSION\}/);
});
