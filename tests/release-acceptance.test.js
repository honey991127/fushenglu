import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createChatState } from '../src/core/chat-state.js';
import {
  buildHandoffInjection,
  commitBatch,
  completeBatch,
  prepareBatchHandoff,
  startBatchCommit,
} from '../src/core/turn-sync.js';
import { productionReviewState } from './helpers/production-fixtures.js';

const timestamp = '2026-08-02T00:00:00.000Z';

test('Phase 8 release fixture commits policy output into snapshot and canonical host handoff', () => {
  const initial = createChatState(timestamp);
  const fixture = productionReviewState(initial, timestamp);

  assert.deepEqual(fixture.normalized.map((candidate) => candidate.kind), [
    'story_time',
    'place',
    'inventory',
  ]);
  assert.deepEqual(fixture.classified.map((candidate) => candidate.disposition), [
    'apply',
    'apply',
    'pending',
  ]);
  assert.equal(fixture.batch.status, 'review_ready');

  let state = startBatchCommit(fixture.state, 'batch:dom', timestamp);
  state = commitBatch(state, 'batch:dom', { timestamp });
  state = prepareBatchHandoff(state, 'batch:dom', { timestamp });
  state = completeBatch(state, 'batch:dom', timestamp);

  assert.equal(state.eventLedger.eventIds.length, 2);
  assert.equal(state.currentSnapshot.currentTime, '三月十八申時');
  assert.equal(state.currentSnapshot.currentPlace, '藏書閣');
  assert.equal(state.pendingItems.length, 1);
  assert.equal(state.currentSnapshot.assets.length, 0);

  const prompt = buildHandoffInjection(state);
  assert.match(prompt.text, /目前時間：三月十八申時/);
  assert.match(prompt.text, /玩家目前在藏書閣/);
  assert.doesNotMatch(prompt.text, /玉佩|pending|proposalId|eventId/);
  assert.deepEqual(buildHandoffInjection(state), prompt);
});

test('Phase 8 release artifacts agree on 0.5.0 and dist is browser-only', async () => {
  const [packageText, manifestText, distManifestText] = await Promise.all([
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
    readFile(new URL('../manifest.json', import.meta.url), 'utf8'),
    readFile(new URL('../dist/fushenglu/manifest.json', import.meta.url), 'utf8'),
  ]);
  const packageJson = JSON.parse(packageText);
  const manifest = JSON.parse(manifestText);
  const distManifest = JSON.parse(distManifestText);

  assert.equal(packageJson.version, '0.5.0');
  assert.equal(manifest.version, '0.5.0');
  assert.equal(distManifest.version, '0.5.0');
  assert.match(distManifest.js, /^src\/index\.[a-f0-9]+\.js$/);
  assert.doesNotMatch(distManifest.js, /v042|happy-dom|node_modules/);
  const runtime = await readFile(new URL('../dist/fushenglu/' + distManifest.js, import.meta.url), 'utf8');
  assert.doesNotMatch(runtime, /__FUSHENGLU_VERSION__|happy-dom|node_modules/);
});
