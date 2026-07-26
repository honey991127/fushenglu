import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHAT_STATE_SCHEMA_VERSION,
  ChatStateMigrationError,
  createChatState,
  exportChatState,
  migrateChatState,
  setSampleValue,
} from '../src/core/chat-state.js';

const NOW = '2026-07-27T00:00:00.000Z';

test('建立帶完整子版本的 V2 ChatState', () => {
  const state = createChatState(NOW);

  assert.equal(state.schemaVersion, CHAT_STATE_SCHEMA_VERSION);
  assert.equal(state.sync.schemaVersion, 1);
  assert.equal(state.testState.schemaVersion, 1);
  assert.equal(state.legacy.schemaVersion, 1);
  assert.deepEqual(state.batches, []);
  assert.deepEqual(state.committedBatchIds, []);
});

test('無版本 V0 與 V1 示例資料可遷移至 V2', () => {
  const v0 = migrateChatState({ exampleValue: '舊值' }, NOW);
  const v1 = migrateChatState(
    { schemaVersion: 1, sampleValue: '第一階段', updatedAt: NOW },
    NOW,
  );

  assert.equal(v0.migrated, true);
  assert.equal(v0.fromVersion, 0);
  assert.equal(v0.state.legacy.sampleValue, '舊值');
  assert.equal(v1.migrated, true);
  assert.equal(v1.fromVersion, 1);
  assert.equal(v1.state.legacy.sampleValue, '第一階段');
});

test('相容示例值寫入仍保留所有 V2 核心資料', () => {
  const state = createChatState(NOW);
  state.committedBatchIds.push('batch_kept');
  const written = setSampleValue(state, '聊天 A', NOW);
  const cleared = setSampleValue(written, null, NOW);

  assert.equal(written.schemaVersion, 2);
  assert.equal(written.legacy.sampleValue, '聊天 A');
  assert.deepEqual(written.committedBatchIds, ['batch_kept']);
  assert.equal(cleared.legacy.sampleValue, null);
});

test('未知未來版本不會被靜默降級', () => {
  assert.throws(
    () => migrateChatState({ schemaVersion: 99 }, NOW),
    ChatStateMigrationError,
  );
});

test('損壞 V2 子資料會停止覆寫', () => {
  const state = createChatState(NOW);
  state.sync.processedSlotKeys = null;

  assert.throws(
    () => migrateChatState(state, NOW),
    /sync\.processedSlotKeys 必須是陣列/,
  );
});

test('匯出會移除 API Key 欄位並遮蔽已知秘密', () => {
  const state = createChatState(NOW);
  state.testState.records.push({
    schemaVersion: 1,
    recordId: 'record-1',
    eventId: 'event-1',
    batchId: 'batch-1',
    kind: 'test',
    operation: 'record',
    value: {
      apiKey: 'sk-secret',
      note: 'key=sk-secret',
    },
    dedupeKey: 'record-1',
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  });
  const exported = exportChatState(state, { secrets: ['sk-secret'] });
  const serialized = JSON.stringify(exported);

  assert.doesNotMatch(serialized, /sk-secret/);
  assert.doesNotMatch(serialized, /apiKey/);
});
