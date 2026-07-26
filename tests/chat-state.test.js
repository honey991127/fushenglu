import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHAT_STATE_SCHEMA_VERSION,
  ChatStateMigrationError,
  createChatState,
  migrateChatState,
  setSampleValue,
} from '../src/core/chat-state.js';

const NOW = '2026-07-27T00:00:00.000Z';

test('建立最小 V1 ChatState', () => {
  assert.deepEqual(createChatState(NOW), {
    schemaVersion: CHAT_STATE_SCHEMA_VERSION,
    sampleValue: null,
    updatedAt: null,
  });
});

test('無版本的 V0 示例資料可遷移至 V1', () => {
  const result = migrateChatState({ exampleValue: '舊值' }, NOW);

  assert.equal(result.migrated, true);
  assert.equal(result.fromVersion, 0);
  assert.deepEqual(result.state, {
    schemaVersion: 1,
    sampleValue: '舊值',
    updatedAt: NOW,
  });
});

test('設定與清空示例值會保留 schemaVersion', () => {
  const written = setSampleValue(createChatState(NOW), '聊天 A', NOW);
  const cleared = setSampleValue(written, null, NOW);

  assert.equal(written.schemaVersion, 1);
  assert.equal(written.sampleValue, '聊天 A');
  assert.equal(cleared.schemaVersion, 1);
  assert.equal(cleared.sampleValue, null);
});

test('未知未來版本不會被靜默降級', () => {
  assert.throws(
    () => migrateChatState({ schemaVersion: 99, sampleValue: 'future' }, NOW),
    ChatStateMigrationError,
  );
});

test('損壞的示例值會停止遷移', () => {
  assert.throws(
    () => migrateChatState({ schemaVersion: 1, sampleValue: 123 }, NOW),
    /示例值必須是字串或 null/,
  );
});
