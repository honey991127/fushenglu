import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BrowserApiSettingsStore,
  OpenAICompatibleClient,
} from '../src/core/api-client.js';
import {
  FLAT_STORY_ANALYSIS_JSON_SCHEMA,
} from '../src/core/flat-analysis.js';

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
    analysisModel: 'gemini-model',
    generationModel: 'gemini-model',
    validationModel: '',
    temperature: 0.2,
    maxOutputTokens: 2048,
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

test('Gemini Schema 不使用 type 陣列', () => {
  const confidence =
    FLAT_STORY_ANALYSIS_JSON_SCHEMA
      .schema
      .properties
      .changes
      .items
      .properties
      .confidence;

  assert.equal(confidence.type, 'number');
  assert.equal(Array.isArray(confidence.type), false);
});

test('Gemini 拒絕 response_schema 時自動改用普通 JSON', async () => {
  const calls = [];
  const client = new OpenAICompatibleClient({
    settingsStore: settingsStore(),
    logger: { warn() {}, error() {}, info() {} },
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);

      if (calls.length === 1) {
        return response(400, {
          error: {
            code: 400,
            message:
              'Invalid JSON payload received. Unknown name "type" at request.generation_config.response_schema: Proto field is not repeating',
            status: 'INVALID_ARGUMENT',
          },
        });
      }

      return response(200, {
        choices: [{
          message: {
            content: '{"schemaVersion":1,"changes":[]}',
          },
        }],
      });
    },
  });

  const result = await client.analyzeMessages([], {
    batchId: 'batch-gemini-fallback',
  });

  assert.equal(result.schemaVersion, 1);
  assert.deepEqual(result.inventoryChanges, []);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].response_format.type, 'json_schema');
  assert.equal(Object.hasOwn(calls[1], 'response_format'), false);
});

test('同一客戶端降級後不再重複送 structured output', async () => {
  const calls = [];
  const client = new OpenAICompatibleClient({
    settingsStore: settingsStore(),
    logger: { warn() {}, error() {}, info() {} },
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);

      if (calls.length === 1) {
        return response(400, {
          error: {
            message:
              'INVALID_ARGUMENT at generation_config.response_schema',
          },
        });
      }

      return response(200, {
        choices: [{
          message: {
            content: '{"schemaVersion":1,"changes":[]}',
          },
        }],
      });
    },
  });

  await client.analyzeMessages([], { batchId: 'first' });
  await client.analyzeMessages([], { batchId: 'second' });

  assert.equal(calls.length, 3);
  assert.equal(Object.hasOwn(calls[0], 'response_format'), true);
  assert.equal(Object.hasOwn(calls[1], 'response_format'), false);
  assert.equal(Object.hasOwn(calls[2], 'response_format'), false);
});