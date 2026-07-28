import test from 'node:test';
import assert from 'node:assert/strict';

import { createEmptyAnalysisResult } from '../src/core/analysis-schema.js';
import {
  BrowserApiSettingsStore,
  DEFAULT_API_SETTINGS,
  OpenAICompatibleClient,
  createChatCompletionsUrl,
  createModelsUrl,
  createSafeLogger,
  exportApiSettings,
  maskApiKey,
  normalizeApiSettings,
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

test('最大輸出 Tokens 接受邊界整數並預設為 2048', () => {
  assert.equal(DEFAULT_API_SETTINGS.maxOutputTokens, 2048);

  for (const value of [1, 2048, 8192, 131072]) {
    assert.equal(
      normalizeApiSettings({ maxOutputTokens: String(value) }).maxOutputTokens,
      value,
    );
  }
});

test('最大輸出 Tokens 拒絕非範圍內整數', () => {
  for (const value of [0, -1, '1.5', '', '   ', 131073]) {
    assert.throws(
      () => normalizeApiSettings({ maxOutputTokens: value }),
      /最大輸出 Tokens 必須是 1 至 131072 的整數/,
    );
  }
});

test('重新開啟設定頁可讀回保存的 URL、模型與 Tokens', () => {
  const storage = memoryStorage();
  const firstStore = new BrowserApiSettingsStore({ storage });
  firstStore.save({
    ...DEFAULT_API_SETTINGS,
    baseUrl: 'https://api.example.test/v1',
    analysisModel: 'analysis-model',
    generationModel: 'generation-model',
    validationModel: 'validation-model',
    maxOutputTokens: '8192',
  });
  const reopenedStore = new BrowserApiSettingsStore({ storage });

  const reopened = reopenedStore.load();
  assert.equal(reopened.baseUrl, 'https://api.example.test/v1');
  assert.equal(reopened.analysisModel, 'analysis-model');
  assert.equal(reopened.generationModel, 'generation-model');
  assert.equal(reopened.validationModel, 'validation-model');
  assert.equal(reopened.maxOutputTokens, 8192);
});

test('載入模型使用正確路徑與 Key，並去重排序', async () => {
  const calls = [];
  const client = new OpenAICompatibleClient({
    settingsStore: settingsStore(),
    logger: { warn() {}, error() {}, info() {} },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(200, {
        data: [
          { id: 'model-z' },
          { id: 'model-a' },
          { id: 'model-z' },
          { id: '' },
        ],
      });
    },
  });

  const models = await client.loadModels();

  assert.deepEqual(models, ['model-a', 'model-z']);
  assert.equal(calls[0].url, 'https://api.example.test/v1/models');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(
    calls[0].options.headers.Authorization,
    'Bearer sk-super-secret',
  );
  assert.equal(
    createModelsUrl('https://api.example.test/v1/'),
    'https://api.example.test/v1/models',
  );
});

test('載入模型可接受空清單', async () => {
  const client = new OpenAICompatibleClient({
    settingsStore: settingsStore(),
    fetchImpl: async () => response(200, { data: [] }),
  });

  assert.deepEqual(await client.loadModels(), []);
});

for (const status of [401, 404]) {
  test(`載入模型 ${status} 不洩漏 API Key`, async () => {
    const client = new OpenAICompatibleClient({
      settingsStore: settingsStore(),
      fetchImpl: async () =>
        response(status, {
          error: { message: 'request sk-super-secret failed' },
        }),
    });

    await assert.rejects(client.loadModels(), (error) => {
      assert.equal(error.status, status);
      assert.doesNotMatch(error.message, /sk-super-secret/);
      assert.match(
        error.message,
        status === 401 ? /API Key 無效/ : /不支援模型列表/,
      );
      return true;
    });
  });
}

test('載入模型拒絕非法 JSON', async () => {
  const client = new OpenAICompatibleClient({
    settingsStore: settingsStore(),
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        throw new SyntaxError('invalid json');
      },
    }),
  });

  await assert.rejects(client.loadModels(), /模型清單不是合法 JSON/);
});

test('測試連線使用實際設定的劇情分析模型', async () => {
  let requestBody;
  const client = new OpenAICompatibleClient({
    settingsStore: settingsStore({
      analysisModel: 'selected-analysis-model',
      generationModel: 'different-generation-model',
      validationModel: 'different-validation-model',
    }),
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return response(200, {
        choices: [{ message: { content: 'OK' } }],
      });
    },
  });

  const result = await client.testConnection();

  assert.equal(requestBody.model, 'selected-analysis-model');
  assert.equal(result.model, 'selected-analysis-model');
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
