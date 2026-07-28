import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatState } from '../src/core/chat-state.js';
import {
  beginTurnBatch,
  normalizeChatMessages,
} from '../src/core/turn-sync.js';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(
  new URL('../src/ui/app.js', import.meta.url),
  'utf8',
);
const syncSource = await readFile(
  new URL('../src/core/turn-sync.js', import.meta.url),
  'utf8',
);

test('強制回溯會包含已處理的既有聊天訊息', () => {
  const messages = [
    { is_user: true, mes: '我取得一百靈石。' },
    { is_user: false, mes: '你收好了靈石。' },
  ];
  const normalized = normalizeChatMessages(messages);
  const state = createChatState('2026-07-29T00:00:00.000Z');
  state.sync.processedSlotKeys = normalized.messages.map(
    (message) => message.slotKey,
  );

  const normal = beginTurnBatch(state, messages, {
    batchId: 'batch_normal',
    timestamp: '2026-07-29T00:01:00.000Z',
  });
  assert.equal(normal.batch.inputMessages.length, 0);

  const forced = beginTurnBatch(state, messages, {
    batchId: 'batch_history',
    timestamp: '2026-07-29T00:02:00.000Z',
    source: 'history_import',
    forceAllMessages: true,
  });
  assert.equal(forced.batch.inputMessages.length, 2);
});

test('介面不再直接把操作物件轉成 object Object', () => {
  assert.match(appSource, /function formatActionValue\(action\)/);
  assert.match(
    appSource,
    /escapeHtml\(formatActionValue\(action\)\)/,
  );
  assert.doesNotMatch(
    appSource,
    /<span>\$\{escapeHtml\(action\.value\)\}<\/span>/,
  );
});

test('貨幣有靈石預設值及送出前中文驗證', () => {
  assert.match(appSource, /data-currency-name value="靈石"/);
  assert.match(appSource, /請輸入貨幣數量。/);
  assert.match(appSource, /貨幣數量必須是大於或等於零的數字。/);
});

test('首頁提供既有聊天樓層掃描入口', () => {
  assert.match(appSource, /data-action="scan-existing-chat"/);
  assert.match(appSource, /source: 'history_import'/);
  assert.match(appSource, /forceAllMessages: true/);
  assert.match(syncSource, /forceAllMessages\s*\?\s*normalizeChatMessages/);
});