import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { applyAnalysisPolicy } from '../src/core/analysis-policy.js';
import { createEmptyAnalysisResult } from '../src/core/analysis-schema.js';
import { createChatState } from '../src/core/chat-state.js';
import {
  buildRollingContext,
  canResumeHistoryImport,
  createHistoryFingerprint,
  createStoryOrder,
  prepareHistoryChunks,
  reduceCurrentSnapshot,
  resolveIdentity,
} from '../src/core/history-consolidation.js';

const NOW = '2026-07-31T00:00:00.000Z';

function candidate(overrides = {}) {
  return { disposition: 'apply', kind: 'story_time', timelineContext: 'main', evidence: { messageIndex: 0, evidenceOrder: 0, messageRef: 'm0' }, normalizedValue: { time: 'day one' }, ...overrides };
}

test('story order is message index then evidence order, never createdAt', () => {
  assert.equal(createStoryOrder({ messageIndex: 3, evidenceOrder: 7 }), 3007);
  const snapshot = reduceCurrentSnapshot([
    candidate({ evidence: { messageIndex: 2, evidenceOrder: 9 }, normalizedValue: { time: 'later' } }),
    candidate({ evidence: { messageIndex: 2, evidenceOrder: 1 }, normalizedValue: { time: 'earlier' } }),
  ]);
  assert.equal(snapshot.currentTime, 'later');
});

test('only main applied time changes current time; non-main and pending do not', () => {
  const snapshot = reduceCurrentSnapshot([
    candidate({ normalizedValue: { time: 'main' } }),
    candidate({ timelineContext: 'dream', normalizedValue: { time: 'dream' }, evidence: { messageIndex: 3, evidenceOrder: 0 } }),
    candidate({ disposition: 'pending', normalizedValue: { time: 'pending' }, evidence: { messageIndex: 4, evidenceOrder: 0 } }),
  ]);
  assert.equal(snapshot.currentTime, 'main');
});

test('player place changes current place while NPC movement remains on that entity', () => {
  const snapshot = reduceCurrentSnapshot([
    candidate({ kind: 'place', subjectRef: { entityId: 'entity:npc:one' }, normalizedValue: { name: 'garden' } }),
    candidate({ kind: 'place', subjectRef: { entityId: 'entity:player' }, normalizedValue: { name: 'library' }, evidence: { messageIndex: 1, evidenceOrder: 0 } }),
  ]);
  assert.equal(snapshot.currentPlace, 'library');
  assert.equal(snapshot.entities['entity:npc:one'].currentLocation, 'garden');
});

test('identity accepts player aliases and confirmed world rules but never guesses an alias', () => {
  const identityContext = { player: { canonicalName: 'Hero', aliases: ['Hero', 'H'] } };
  assert.equal(resolveIdentity({ rawName: 'H' }, identityContext).entityId, 'entity:player');
  assert.equal(resolveIdentity({ rawName: 'Mo' }, {}, { entries: [{ confirmed: true, canonicalName: 'Mo', aliases: ['M'], entityId: 'entity:npc:mo' }] }).entityId, 'entity:npc:mo');
  assert.equal(resolveIdentity({ rawName: 'Unknown' }, identityContext).resolved, false);
});

test('policy resolves a confirmed player alias before applying inventory', () => {
  const state = createChatState(NOW);
  const analysis = createEmptyAnalysisResult();
  analysis.inventoryChanges.push({ kind: 'inventory', operation: 'add', subjectRef: { rawName: 'Hero' }, value: { name: 'tea', quantity: 1 }, confidence: 0.9, evidence: { messageRef: 'm1', messageIndex: 0, quote: 'Hero receives tea.', evidenceOrder: 0 } });
  const [result] = applyAnalysisPolicy(analysis, state, { identityContext: { player: { canonicalName: 'Hero', aliases: ['Hero'] } } });
  assert.equal(result.disposition, 'apply');
  assert.equal(result.subjectRef.entityId, 'entity:player');
});

test('history chunks retain two preceding messages and carry identity and rolling context', () => {
  const messages = Array.from({ length: 5 }, (_, index) => ({ messageRef: `m${index}`, role: 'assistant', speakerName: 'npc', content: String(index), index }));
  const chunks = prepareHistoryChunks(messages, (items) => [items.slice(0, 2), items.slice(2, 4), items.slice(4)], { overlapMessages: 2, identityContext: { player: { canonicalName: 'Hero' } }, rollingContext: { currentTime: 'noon' } });
  assert.deepEqual(chunks[1].overlapMessageRefs, ['m0', 'm1']);
  assert.equal(chunks[1].messages[0].speakerName, 'npc');
  assert.equal(chunks[1].identityContext.player.canonicalName, 'Hero');
  assert.equal(chunks[1].rollingContext.currentTime, 'noon');
});

test('history resume requires all fingerprints and boundaries to match', () => {
  const messages = [{ messageRef: 'm1', role: 'user', content: 'one' }, { messageRef: 'm2', role: 'assistant', content: 'two' }];
  const fingerprint = createHistoryFingerprint(messages, [messages]);
  assert.equal(canResumeHistoryImport({ schemaVersion: 1, ...fingerprint }, fingerprint), true);
  assert.equal(canResumeHistoryImport({ schemaVersion: 1, ...fingerprint, messageRefsHash: 'changed' }, fingerprint), false);
});

test('rolling context exposes only confirmed identity anchors and bounded known fact keys', () => {
  const context = buildRollingContext({ snapshot: { currentTime: 'noon', currentPlace: 'room' }, identityContext: { player: { canonicalName: 'Hero' } }, entities: { byId: { 'entity:npc': { entityId: 'entity:npc', canonicalName: 'Mo', aliases: ['M'] } } }, worldRules: { entries: [{ confirmed: true, canonicalName: 'Mo', aliases: ['M'] }, { confirmed: false, canonicalName: 'Guess' }] }, factKeys: ['a', 'a', 'b'] });
  assert.deepEqual(context.knownFactKeys, ['a', 'b']);
  assert.equal(context.confirmedWorldRules.length, 1);
});

test('API analysis accepts rolling context and the UI persists resumable fingerprints', async () => {
  const [api, app] = await Promise.all([
    readFile(new URL('../src/core/api-client.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/ui/app.js', import.meta.url), 'utf8'),
  ]);
  assert.match(api, /rollingContext/);
  assert.match(app, /prepareHistoryChunks/);
  assert.match(app, /createHistoryFingerprint/);
  assert.match(app, /canResumeHistoryImport/);
});
