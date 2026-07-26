import test from 'node:test';
import assert from 'node:assert/strict';

import { createEmptyAnalysisResult } from '../src/core/analysis-schema.js';
import {
  BrowserApiSettingsStore,
  OpenAICompatibleClient,
  createChatCompletionsUrl,
  createSafeLogger,
  exportApiSettings,
  maskApiKey,
} from '../src/core/api-client.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

function settingsStore(overrides = {}) {
  const store = new BrowserApiSettingsStore({ storage: memoryStorage() });
  store.save({
    schemaVersion: 1,
    baseUrl: 'https://api.example.test/v1',
    apiKey: 'sk-super-secret',
    analysisModel: 'same-model',
    generationModel: 'same-model',
    validationModel: '',
    temperature: 0.2,
    maxOutputTokens: 900,
    ...overrides,
  });
  return store;
}

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

test('三個模型槽位可使用相同模型，匯出不含 API Key', () => {
  const store = settingsStore({ validationModel: 'same-model' });
  const loaded = store.load();
  const exported = exportApiSettings(loaded);

  assert.equal(loaded.analysisModel, loaded.generationModel);
  assert.equal(loaded.generationModel, loaded.validationModel);
  assert.equal(Object.hasOwn(exported, 'apiKey'), false);
  assert.doesNotMatch(JSON.stringify(store.export()), /sk-super-secret/);
  assert.match(maskApiKey(loaded.apiKey), /cret$/);
});

test('日誌會遮蔽完整 API Key 與敏感欄位', () => {
  const entries = [];
  const logger = createSafeLogger(
    {
      error(...args) {
        entries.push(args);
      },
    },
    () => ['sk-super-secret'],
  );

  logger.error('request sk-super-secret failed', {
    authorization: 'Bearer sk-super-secret',
    nested: 'sk-super-secret',
  });
  const serialized = JSON.stringify(entries);

  assert.doesNotMatch(serialized, /sk-super-secret/);
  assert.match(serialized, /REDACTED/);
});

test('標準 Base URL 會建立 chat completions 端點', () => {
  assert.equal(
    createChatCompletionsUrl('https://api.example.test/v1/'),
    'https://api.example.test/v1/chat/completions',
  );
  assert.equal(
    createChatCompletionsUrl(
      'https://api.example.test/v1/chat/completions',
    ),
    'https://api.example.test/v1/chat/completions',
  );
});

test('structured output 不支援時降級為 JSON 解析與本地 Schema 驗證', async () => {
  const calls = [];
  const result = createEmptyAnalysisResult();
  const client = new OpenAICompatibleClient({
    settingsStore: settingsStore(),
    logger: { warn() {}, error() {}, info() {} },
    fetchImpl: async (_url, options) => {
      calls.push(JSON.parse(options.body));

      if (calls.length === 1) {
        return response(400, {
          error: { message: 'response_format json_schema is unsupported' },
        });
      }

      return response(200, {
        choices: [{ message: { content: JSON.stringify(result) } }],
      });
    },
  });

  const analyzed = await client.analyzeMessages([], { batchId: 'batch-1' });

  assert.deepEqual(analyzed, result);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].response_format.type, 'json_schema');
  assert.equal(Object.hasOwn(calls[1], 'response_format'), false);
});

test('不合法 AI JSON 會拒絕整份分析', async () => {
  const client = new OpenAICompatibleClient({
    settingsStore: settingsStore(),
    logger: { warn() {}, error() {}, info() {} },
    fetchImpl: async () =>
      response(200, {
        choices: [{ message: { content: '{"inventoryChanges":[]}' } }],
      }),
  });

  await assert.rejects(
    client.analyzeMessages([], { batchId: 'batch-invalid' }),
    /不符合 Schema/,
  );
});
