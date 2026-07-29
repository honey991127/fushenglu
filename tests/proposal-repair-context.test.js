import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BrowserApiSettingsStore,
  OpenAICompatibleClient,
} from '../src/core/api-client.js';
import { createEmptyAnalysisResult } from '../src/core/analysis-schema.js';
import {
  inspectProposalPayload,
  repairedProposalIsGrounded,
} from '../src/core/proposal-repair.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

function settingsStore() {
  const store = new BrowserApiSettingsStore({
    storage: memoryStorage(),
  });
  store.save({
    schemaVersion: 1,
    baseUrl: 'https://api.example.test/v1',
    apiKey: 'test-key',
    analysisModel: 'analysis-model',
    generationModel: 'generation-model',
    validationModel: '',
    temperature: 0.2,
    maxOutputTokens: 2048,
  });
  return store;
}

function response(content) {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        choices: [{ message: { content } }],
      };
    },
  };
}

test('任意世界觀的原文名稱都可通過，不依賴固定詞庫', () => {
  for (const name of [
    '量子門禁憑證',
    '員工識別證',
    '月影長弓',
    'NX-47 維修模組',
  ]) {
    const inspected = inspectProposalPayload({
      proposalId: `proposal-${name}`,
      kind: 'inventory',
      operation: 'add',
      value: { name, quantity: 1 },
      confidence: 0.9,
      evidenceMessageRef: 'message:1',
      reason: '原文明確取得',
      severity: 'minor',
      dedupeKey: `inventory:${name}`,
    });

    assert.equal(inspected.complete, true);
  }
});

test('修復名稱必須逐字存在於目前聊天，不可從其他世界補造', () => {
  const candidate = {
    proposalId: 'proposal-1',
    kind: 'inventory',
    operation: 'add',
    value: { name: '量子鑰匙', quantity: 1 },
    confidence: 0.9,
    evidenceMessageRef: 'message:1',
    reason: '原文取得',
    severity: 'minor',
    dedupeKey: 'inventory:key',
  };

  assert.equal(
    repairedProposalIsGrounded(candidate, [
      {
        messageRef: 'message:1',
        role: 'assistant',
        content: '他把量子鑰匙交到你手中。',
      },
    ]),
    true,
  );
  assert.equal(
    repairedProposalIsGrounded(candidate, [
      {
        messageRef: 'message:1',
        role: 'assistant',
        content: '他交給你一件未說明名稱的物品。',
      },
    ]),
    false,
  );
});

test('缺少名稱時 AI 只根據當前聊天逐筆修復', async () => {
  let calls = 0;
  const client = new OpenAICompatibleClient({
    settingsStore: settingsStore(),
    logger: { warn() {}, error() {}, info() {} },
    fetchImpl: async () => {
      calls += 1;

      if (calls === 1) {
        return response(JSON.stringify({
          schemaVersion: 1,
          changes: [{
            kind: 'inventory',
            operation: 'add',
            value: { quantity: 1 },
            evidenceMessageRef: 'message:1',
            confidence: 0.9,
            reason: '取得一件物品',
            severity: 'minor',
            dedupeKey: 'inventory:unknown',
          }],
        }));
      }

      return response(JSON.stringify({
        schemaVersion: 1,
        changes: [{
          kind: 'inventory',
          operation: 'add',
          value: {
            name: 'NX-47 維修模組',
            quantity: 1,
          },
          evidenceMessageRef: 'message:1',
          confidence: 0.95,
          reason: '名稱逐字出現在原文',
          severity: 'minor',
          dedupeKey: 'ignored-by-repair',
        }],
      }));
    },
  });

  const result = await client.analyzeMessages(
    [{
      messageRef: 'message:1',
      role: 'assistant',
      content: '你取得了 NX-47 維修模組。',
    }],
    { batchId: 'batch-context-repair' },
  );

  assert.equal(calls, 2);
  assert.equal(result.inventoryChanges.length, 1);
  assert.equal(
    result.inventoryChanges[0].value.name,
    'NX-47 維修模組',
  );
  assert.equal(result.uncertainItems.length, 0);
});

test('AI 無法從原文確定名稱時不猜，改送待確認且不令整批失敗', async () => {
  let calls = 0;
  const client = new OpenAICompatibleClient({
    settingsStore: settingsStore(),
    logger: { warn() {}, error() {}, info() {} },
    fetchImpl: async () => {
      calls += 1;

      if (calls === 1) {
        return response(JSON.stringify({
          schemaVersion: 1,
          changes: [{
            kind: 'inventory',
            operation: 'add',
            value: { quantity: 1 },
            evidenceMessageRef: 'message:2',
            confidence: 0.9,
            reason: '取得物品',
            severity: 'minor',
            dedupeKey: 'inventory:unnamed',
          }],
        }));
      }

      return response(JSON.stringify({
        schemaVersion: 1,
        changes: [],
      }));
    },
  });

  const result = await client.analyzeMessages(
    [{
      messageRef: 'message:2',
      role: 'assistant',
      content: '你得到一件沒有說明名稱的東西。',
    }],
    { batchId: 'batch-unresolved' },
  );

  assert.equal(calls, 2);
  assert.equal(result.inventoryChanges.length, 0);
  assert.equal(result.uncertainItems.length, 1);
  assert.equal(
    result.uncertainItems[0].repairStatus,
    'unresolved',
  );
});

test('沒有不完整候選時不增加額外 API 請求', async () => {
  let calls = 0;
  const complete = createEmptyAnalysisResult();
  complete.inventoryChanges.push({
    proposalId: 'proposal-complete',
    kind: 'inventory',
    operation: 'add',
    value: { name: '普通雨傘', quantity: 1 },
    confidence: 0.95,
    evidenceMessageRef: 'message:3',
    reason: '原文明確取得',
    severity: 'minor',
    dedupeKey: 'inventory:umbrella',
  });

  const client = new OpenAICompatibleClient({
    settingsStore: settingsStore(),
    logger: { warn() {}, error() {}, info() {} },
    fetchImpl: async () => {
      calls += 1;
      return response(JSON.stringify(complete));
    },
  });

  const result = await client.analyzeMessages(
    [{
      messageRef: 'message:3',
      role: 'assistant',
      content: '你拿起普通雨傘。',
    }],
    { batchId: 'batch-no-extra-call' },
  );

  assert.equal(calls, 1);
  assert.equal(result.inventoryChanges.length, 1);
});