import test from 'node:test';
import assert from 'node:assert/strict';

import { createEmptyAnalysisResult } from '../src/core/analysis-schema.js';
import { applyAnalysisPolicy } from '../src/core/analysis-policy.js';
import { CandidateValidationError, normalizeCandidate } from '../src/core/candidate-normalizer.js';
import { createChatState } from '../src/core/chat-state.js';
import { createEventId } from '../src/core/event-id.js';
import { createFactKey } from '../src/core/fact-key.js';
import { classifyCandidate } from '../src/core/semantic-classifier.js';

const NOW = '2026-07-31T00:00:00.000Z';

function rawCandidate(overrides = {}) {
  return {
    kind: 'inventory',
    operation: 'add',
    subjectRef: { entityId: 'entity:player', role: 'player' },
    value: { name: 'letter', quantity: 1 },
    timelineContext: 'main',
    evidence: { messageRef: 'message:1', messageIndex: 3, speakerName: 'npc', quote: 'The NPC gives the player a letter.', evidenceOrder: 1 },
    confidence: 0.9,
    modelUncertain: false,
    ...overrides,
  };
}

function classify(raw, state = createChatState(NOW)) {
  return classifyCandidate(normalizeCandidate(raw), { state });
}

test('uncertain model output with explicit player delivery still applies', () => {
  const result = classify(rawCandidate({ modelUncertain: true }));
  assert.equal(result.disposition, 'apply');
  assert.equal(result.requiresPlayerDecision, false);
});

test('displayed, mentioned, and NPC-owned inventory never becomes player inventory', () => {
  const display = classify(rawCandidate({ evidence: { messageRef: 'message:1', messageIndex: 3, quote: '\u5546\u5e97\u5c55\u793a\u4e00\u628a\u528d', evidenceOrder: 1 } }));
  const npc = classify(rawCandidate({ subjectRef: { entityId: 'entity:npc', role: 'npc' }, value: { name: 'phone', quantity: 1 }, evidence: { messageRef: 'message:1', messageIndex: 3, quote: '\u6a94\u6848\u8a18\u9304 NPC \u6301\u6709\u624b\u6a5f', evidenceOrder: 1 } }));
  assert.equal(display.disposition, 'discard');
  assert.notEqual(npc.disposition, 'apply');
});

test('inventory owner and quantity are never guessed', () => {
  const ownerless = classify(rawCandidate({ subjectRef: {}, value: { name: 'coin', quantity: 1 } }));
  const quantityless = classify(rawCandidate({ value: { name: 'letter' } }));
  assert.equal(ownerless.disposition, 'pending');
  assert.equal(quantityless.disposition, 'pending');
});

test('ambiguous quantity text is retained, while explicit singular wording may normalize to one', () => {
  const cakes = classify(rawCandidate({ value: { name: 'cakes', quantity: { text: '\u4e00\u4e9b\u7cd5\u9ede' } } }));
  const letter = classify(rawCandidate({ value: { name: 'letter' }, evidence: { messageRef: 'message:1', messageIndex: 3, quote: '\u4ed6\u628a\u90a3\u5c01\u4fe1\u4ea4\u7d66\u73a9\u5bb6', evidenceOrder: 1 } }));
  assert.equal(cakes.disposition, 'apply');
  assert.equal(cakes.normalizedValue.quantity.text, '\u4e00\u4e9b\u7cd5\u9ede');
  assert.equal(letter.disposition, 'apply');
  assert.equal(letter.normalizedValue.quantity.exact, 1);
});

test('all non-main timeline contexts are suppressed from the current snapshot', () => {
  for (const timelineContext of ['memory', 'dream', 'hypothetical', 'hearsay', 'plan']) {
    assert.equal(classify(rawCandidate({ timelineContext })).disposition, 'suppress');
  }
});

test('fact keys are local and do not depend on model dedupeKey', () => {
  const first = normalizeCandidate(rawCandidate({ dedupeKey: 'model-one' }));
  const second = normalizeCandidate(rawCandidate({ dedupeKey: 'model-two' }));
  assert.equal(createFactKey(first), createFactKey(second));
  assert.equal(Object.hasOwn(first, 'dedupeKey'), false);
});

test('acquire and consume in one message receive distinct local event ids', () => {
  const acquire = normalizeCandidate(rawCandidate());
  const consume = normalizeCandidate(rawCandidate({ operation: 'consume', evidence: { messageRef: 'message:1', messageIndex: 3, quote: 'The player immediately consumes the letter.', evidenceOrder: 2 } }));
  assert.notEqual(createEventId({ ...acquire, factKey: createFactKey(acquire) }), createEventId({ ...consume, factKey: createFactKey(consume) }));
});

test('a committed matching fact is suppressed on re-analysis', () => {
  const candidate = normalizeCandidate(rawCandidate());
  const state = createChatState(NOW);
  state.events.push({ factKey: createFactKey(candidate), deletedAt: null });
  assert.equal(classifyCandidate(candidate, { state }).disposition, 'suppress');
});

test('invalid kind, operation, and evidence have explicit validation errors', () => {
  assert.throws(() => normalizeCandidate(rawCandidate({ kind: 'unknown_kind' })), CandidateValidationError);
  assert.throws(() => normalizeCandidate(rawCandidate({ operation: 'teleport' })), CandidateValidationError);
  assert.throws(() => normalizeCandidate(rawCandidate({ evidence: undefined, evidenceMessageRef: undefined })), CandidateValidationError);
});

test('policy output is compatible with V5 state and ignores model buckets', () => {
  const state = createChatState(NOW);
  const analysis = createEmptyAnalysisResult();
  analysis.uncertainItems.push({ ...rawCandidate({ modelUncertain: true }), evidenceMessageRef: 'message:1', evidenceQuote: 'The NPC gives the player a letter.' });
  const [result] = applyAnalysisPolicy(analysis, state);
  assert.equal(state.schemaVersion, 5);
  assert.equal(result.disposition, 'apply');
});
