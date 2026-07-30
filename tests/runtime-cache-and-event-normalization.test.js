import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createChatState, validateChatState } from '../src/core/chat-state.js';
const NOW = '2026-07-30T12:00:00.000Z';
function makeEvent({ schemaVersion, includeVersion = true, eventId }) {
  const event = { eventId, batchId: 'batch-runtime-cache', sourceType: 'analysis', sourceProposalId: null, sourceActionId: null, sourceMessageRefs: ['message:1'], sourceMessageRef: 'message:1', sourceMessageIndex: 0, storyOrder: 0, evidenceQuote: 'time advanced', timelineContext: 'main', subjectEntityId: null, factKey: 'story:current-time', kind: 'story_time', operation: 'advance_time', value: { time: 'time' }, dedupeKey: 'message:1:' + eventId, createdAt: NOW, updatedAt: NOW, deletedAt: null };
  if (includeVersion) event.schemaVersion = schemaVersion;
  return event;
}
test('events accept known and recognizable legacy schema versions', () => {
  const state = createChatState(NOW);
  state.events = [makeEvent({ schemaVersion: 1, eventId: 'event-v1' }), makeEvent({ schemaVersion: 2, eventId: 'event-v2' }), makeEvent({ includeVersion: false, eventId: 'event-legacy' })];
  assert.deepEqual(validateChatState(state, NOW).events.map((event) => event.schemaVersion), [1, 2, 1]);
});
test('unknown event versions remain rejected', () => {
  const state = createChatState(NOW);
  state.events = [makeEvent({ schemaVersion: 7, eventId: 'event-v7' })];
  assert.throws(() => validateChatState(state, NOW), /7/);
});
test('source manifest points to the single editable runtime entry', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  const entry = await readFile(new URL('../' + manifest.js, import.meta.url), 'utf8');
  assert.equal(manifest.js, 'src/index.js');
  assert.doesNotMatch(manifest.js, /\.v\d+\.js$/);
  assert.doesNotMatch(entry, /\.v\d+\.js/);
});
test('API source reads the build-time version placeholder module', async () => {
  const source = await readFile(new URL('../src/ui/app.js', import.meta.url), 'utf8');
  assert.match(source, /from '..\/version\.js';/);
  assert.doesNotMatch(source, /const APP_VERSION\s*=/);
  assert.match(source, /v\$\{APP_VERSION\}/);
});
