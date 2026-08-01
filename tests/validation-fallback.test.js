import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createEmptyAnalysisResult,
  parseAndValidateValidationResult,
} from '../src/core/analysis-schema.js';
import { BrowserApiSettingsStore, OpenAICompatibleClient } from '../src/core/api-client.js';
import { beginTurnBatch, completeBatchAnalysis } from '../src/core/turn-sync.js';
import { createChatState } from '../src/core/chat-state.js';

function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
}

function settingsStore() {
  const store = new BrowserApiSettingsStore({ storage: storage() });
  store.save({ schemaVersion: 1, baseUrl: 'https://api.example.test/v1', apiKey: 'sk-test-secret', analysisModel: 'analysis', generationModel: 'analysis', validationModel: 'validator', temperature: 0, maxOutputTokens: 256, confirmationMode: 'auto_commit_safe' });
  return store;
}

function response(status, content) {
  return { ok: status >= 200 && status < 300, status, async json() { return status >= 200 && status < 300 ? { choices: [{ message: { content } }] } : { error: { message: 'validation unavailable' } }; } };
}

function analysisResult() {
  const result = createEmptyAnalysisResult();
  result.storyTimeChanges.push({ proposalId: 'time-1', kind: 'story_time', operation: 'set', value: { time: '三月十八申時' }, confidence: 0.99, evidenceMessageRef: 'message:1', reason: '主線明確時間', severity: 'minor', dedupeKey: 'untrusted-model-key', timelineContext: 'main' });
  result.evidence.push({ messageRef: 'message:1', quote: '三月十八申時。' });
  return result;
}

function clientFor(validationReplies) {
  const replies = [...validationReplies];
  return new OpenAICompatibleClient({
    settingsStore: settingsStore(),
    logger: { warn() {}, error() {}, info() {} },
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.model === 'analysis') return response(200, JSON.stringify(analysisResult()));
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      if (reply?.status) return response(reply.status, '');
      return response(200, reply);
    },
  });
}

test('validation response accepts canonical JSON, code fences, and result/data/output wrappers', () => {
  for (const value of [
    '{"schemaVersion":1,"valid":true,"issues":[]}',
    '```json\n{"schemaVersion":1,"valid":true,"issues":[]}\n```',
    '{"result":{"schemaVersion":1,"valid":true,"issues":[]}}',
    '{"data":{"schemaVersion":1,"valid":true,"issues":[]}}',
    '{"output":{"schemaVersion":1,"valid":true,"issues":[]}}',
  ]) {
    assert.deepEqual(parseAndValidateValidationResult(value), { schemaVersion: 1, valid: true, issues: [] });
  }
});

test('invalid validation formatting preserves local-schema analysis candidates with a manual warning', async () => {
  const client = clientFor(['not valid JSON']);
  const result = await client.analyzeMessages([{ messageRef: 'message:1', role: 'assistant', content: '三月十八申時。' }], { batchId: 'validation-format', repairCandidates: false });
  assert.equal(result.storyTimeChanges.length, 1);
  assert.equal(result.validationWarning.reasonCode, 'validation_response_invalid');

  const state = beginTurnBatch(createChatState('2026-08-02T00:00:00.000Z'), [], { batchId: 'validation-format', timestamp: '2026-08-02T00:00:00.000Z' }).state;
  const completed = completeBatchAnalysis(state, 'validation-format', result, '2026-08-02T00:00:00.000Z');
  assert.equal(completed.batches[0].status, 'review_ready');
  assert.equal(completed.batches[0].detectedChanges.length, 1);
  assert.equal(completed.batches[0].validationWarning.reasonCode, 'validation_response_invalid');
});

test('validation API rejection preserves candidates and records a manual warning', async () => {
  const client = clientFor([{ status: 503 }]);
  const result = await client.analyzeMessages([{ messageRef: 'message:1', role: 'assistant', content: '三月十八申時。' }], { batchId: 'validation-reject', repairCandidates: false });
  assert.equal(result.storyTimeChanges.length, 1);
  assert.equal(result.validationWarning.reasonCode, 'validation_api_unavailable');
});

test('valid false performs at most one advisory repair and then keeps candidates for manual confirmation', async () => {
  const client = clientFor([
    '{"schemaVersion":1,"valid":false,"issues":["請人工核對"]}',
    '{"schemaVersion":1,"valid":false,"issues":["仍需人工核對"]}',
  ]);
  let repairs = 0;
  client.repairIncompleteAnalysis = async (result) => { repairs += 1; return result; };
  const result = await client.analyzeMessages([{ messageRef: 'message:1', role: 'assistant', content: '三月十八申時。' }], { batchId: 'validation-false', repairCandidates: false });
  assert.equal(repairs, 1);
  assert.equal(result.storyTimeChanges.length, 1);
  assert.equal(result.validationWarning.reasonCode, 'validation_rejected');
});
