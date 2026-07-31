import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BrowserApiSettingsStore,
  OpenAICompatibleClient,
} from '../src/core/api-client.js';
import { createEmptyAnalysisResult } from '../src/core/analysis-schema.js';

function store() {
  const data = new Map();
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
  const result = new BrowserApiSettingsStore({ storage });
  result.save({
    schemaVersion: 1,
    baseUrl: 'https://api.example.test/v1',
    apiKey: 'key',
    analysisModel: 'model',
    generationModel: 'model',
    validationModel: '',
    temperature: 0.2,
    maxOutputTokens: 2048,
  });
  return result;
}

test('16 筆候選只發出兩次批次修復請求', async () => {
  const analysis = createEmptyAnalysisResult();
  const messages = [];
  for (let index = 1; index <= 16; index += 1) {
    analysis.inventoryChanges.push({
      proposalId: `p-${index}`,
      kind: 'inventory',
      operation: 'add',
      value: { quantity: 1 },
      confidence: 0.9,
      evidenceMessageRef: `m-${index}`,
      reason: '取得物品',
      severity: 'minor',
      dedupeKey: `d-${index}`,
    });
    messages.push({
      messageRef: `m-${index}`,
      role: 'assistant',
      content: `取得物品-${index}。`,
    });
  }

  let calls = 0;
  const client = new OpenAICompatibleClient({
    settingsStore: store(),
    logger: { warn() {}, error() {}, info() {} },
    fetchImpl: async (_url, options) => {
      calls += 1;
      const input = JSON.parse(
        JSON.parse(options.body).messages[1].content,
      );
      const changes = input.incompleteCandidates.map((item) => ({
        ...item.incompleteCandidate,
        proposalId: item.proposalId,
        value: {
          name: `物品-${item.proposalId.split('-')[1]}`,
          quantity: 1,
        },
      }));
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  schemaVersion: 1,
                  changes,
                }),
              },
            }],
          };
        },
      };
    },
  });

  const result = await client.repairIncompleteAnalysis(
    analysis,
    messages,
    { batchId: 'bulk' },
  );
  assert.equal(calls, 2);
  assert.equal(result.inventoryChanges.length, 16);
  assert.equal(result.uncertainItems.length, 0);
});

test('history repair maxRequests limits the entire stage to one request', async () => {
  const analysis = createEmptyAnalysisResult();
  const messages = [];
  for (let index = 1; index <= 16; index += 1) { analysis.inventoryChanges.push({ proposalId: `p-${index}`, kind: 'inventory', operation: 'add', value: { quantity: 1 }, confidence: 0.9, evidenceMessageRef: `m-${index}`, reason: 'missing name', severity: 'minor', dedupeKey: `d-${index}` }); messages.push({ messageRef: `m-${index}`, role: 'assistant', content: 'item' }); }
  let calls = 0;
  const client = new OpenAICompatibleClient({ settingsStore: store(), logger: { warn() {}, error() {}, info() {} }, fetchImpl: async () => { calls += 1; throw new Error('repair unavailable'); } });
  const result = await client.repairIncompleteAnalysis(analysis, messages, { batchId: 'history', maxRequests: 1 });
  assert.equal(calls, 1);
  assert.equal(result.inventoryChanges.length + result.uncertainItems.length, 16);
});
