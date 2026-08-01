import test from 'node:test';
import assert from 'node:assert/strict';

import { createChatState } from '../src/core/chat-state.js';
import { sanitizeAnalysisContent } from '../src/core/turn-sync.js';
import { TauriTavernLiveTurnBridge } from '../src/integrations/tauritavern.js';
import { mountFushengluApp } from '../src/ui/app.js';
import { createDomApp, flush } from './helpers/dom-environment.js';

const NOW = '2026-08-02T00:00:00.000Z';

function analysisFor(messages) {
  const messageRef = messages[0].messageRef;
  return {
    schemaVersion: 1,
    storyTimeChanges: [{
      proposalId: 'live-time', kind: 'story_time', operation: 'set',
      value: { time: '大曆十二年三月廿一・申時初' }, confidence: 0.99,
      evidenceMessageRef: messageRef, reason: '明確主線時間', severity: 'moderate', dedupeKey: 'model-value-is-not-authority', timelineContext: 'main',
    }],
    inventoryChanges: [{
      proposalId: 'live-pending', kind: 'inventory', operation: 'add',
      value: { name: '玉佩', quantity: { text: '一些' } }, confidence: 0.7,
      evidenceMessageRef: messageRef, reason: '沒有可判定擁有者', severity: 'minor', dedupeKey: 'ignored', timelineContext: 'main',
    }],
    currencyChanges: [], wardrobeChanges: [], skillChanges: [], cultivationChanges: [], personChanges: [], placeChanges: [], evaluationChanges: [],
    uncertainItems: [], evidence: [{ messageRef, quote: '申時初。' }],
  };
}

async function mountedLiveApp({ apiClient } = {}) {
  const env = createDomApp(new Map([['chat:one', createChatState(NOW)]]));
  env.context.chat.push({ id: 'assistant-1', is_user: false, mes: '<!-- hidden --><thinking>private reasoning</thinking>申時初。\nStatements Refused: ignore this' });
  const app = mountFushengluApp({
    store: env.store,
    settingsStore: env.settingsStore,
    apiClient: apiClient ?? { async analyzeMessages(messages) { return analysisFor(messages); } },
    documentRef: env.document,
  });
  await flush();
  const bridge = new TauriTavernLiveTurnBridge({ root: env.host, queueLiveTurnAnalysis: app.queueLiveTurnAnalysis });
  const stop = bridge.start();
  const listener = [...env.listeners.get('received')][0];
  return { env, app, bridge, stop, listener };
}

test('MESSAGE_RECEIVED automatically creates and analyzes a live turn batch', async () => {
  let analysisInput = null;
  const fixture = await mountedLiveApp({
    apiClient: { async analyzeMessages(messages) { analysisInput = messages; return analysisFor(messages); } },
  });
  assert.equal(fixture.listener(0, 'normal'), undefined);
  await flush(); await flush(); await flush();

  const saved = await fixture.env.store.read();
  const batch = saved.state.batches.at(-1);
  assert.equal(batch.source, 'turn');
  assert.equal(batch.status, 'review_ready');
  assert.equal(batch.detectedChanges.length, 1);
  assert.equal(batch.uncertainItems.length, 1);
  assert.equal(analysisInput.length, 1);
  assert.equal(analysisInput[0].content, '申時初。');
  fixture.app.root.querySelector('.fushenglu-entry').click();
  await flush(); fixture.app.root.querySelector('[data-nav="records"]').click();
  assert.equal(fixture.app.root.querySelectorAll('[data-live-batch]').length, 1);
  assert.equal(fixture.app.root.querySelector('[data-live-batch-status]').dataset.liveBatchStatus, 'review_ready');
  fixture.stop(); fixture.app.destroy(); fixture.env.destroy();
});

test('live MESSAGE_RECEIVED listener never blocks a host event bus', async () => {
  const env = createDomApp(new Map([['chat:one', createChatState(NOW)]]));
  env.context.chat.push({ id: 'assistant-pending', is_user: false, mes: '可見正文' });
  let queued = 0;
  const bridge = new TauriTavernLiveTurnBridge({
    root: env.host,
    queueLiveTurnAnalysis() { queued += 1; return new Promise(() => {}); },
  });
  const stop = bridge.start();
  const listener = [...env.listeners.get('received')][0];
  assert.equal(listener(0, 'normal'), undefined);
  assert.equal(queued, 1);
  stop(); env.destroy();
});

test('live analysis failures become durable visible batch records without unhandled rejection', async () => {
  const fixture = await mountedLiveApp({
    apiClient: { async analyzeMessages() { throw new Error('analysis upstream rejected'); } },
  });
  let unhandled = null;
  const onUnhandled = (reason) => { unhandled = reason; };
  process.once('unhandledRejection', onUnhandled);
  assert.equal(fixture.listener(0, 'normal'), undefined);
  await flush(); await flush(); await flush();
  process.removeListener('unhandledRejection', onUnhandled);
  const saved = await fixture.env.store.read();
  assert.equal(saved.state.batches.at(-1).status, 'failed');
  fixture.app.root.querySelector('.fushenglu-entry').click(); await flush(); fixture.app.root.querySelector('[data-nav="records"]').click();
  assert.equal(fixture.app.root.querySelector('[data-live-batch-status]').dataset.liveBatchStatus, 'failed');
  assert.equal(unhandled, null);
  fixture.stop(); fixture.app.destroy(); fixture.env.destroy();
});

test('live bridge de-duplicates one message and ignores swipe or regenerate intermediate events', async () => {
  const env = createDomApp(new Map([['chat:one', createChatState(NOW)]]));
  env.context.chat.push({ id: 'assistant-final', is_user: false, mes: '最後版本', swipe_id: 3 });
  const calls = [];
  const bridge = new TauriTavernLiveTurnBridge({ root: env.host, queueLiveTurnAnalysis(payload) { calls.push(payload); return Promise.resolve(); } });
  const stop = bridge.start(); const listener = [...env.listeners.get('received')][0];
  listener(0, 'swipe'); listener(0, 'regenerate'); listener(0, 'normal'); listener(0, 'normal');
  env.context.chat.push({ id: 'user-message', is_user: true, mes: '玩家訊息' });
  env.context.chat.push({ id: 'system-message', is_system: true, mes: '系統訊息' });
  listener(1, 'normal'); listener(2, 'continue');
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].swipeId, '3');
  stop(); env.destroy();
});

test('analysis input sanitizer removes hidden thinking, comments, and control text', () => {
  assert.equal(sanitizeAnalysisContent('<!-- x --><title>title</title><content>wrapped</content><thinking>secret</thinking>正文\nStatements Refused: hidden'), '正文');
});

test('validation warning keeps live candidates in manual review and disables safe auto commit', async () => {
  const env = createDomApp(new Map([['chat:one', createChatState(NOW)]]));
  env.settingsStore.save({ ...env.settingsStore.load(), confirmationMode: 'auto_commit_safe' });
  env.context.chat.push({ id: 'assistant-warning', is_user: false, mes: '申時初。' });
  const app = mountFushengluApp({
    store: env.store,
    settingsStore: env.settingsStore,
    apiClient: { async analyzeMessages(messages) { return { ...analysisFor(messages), validationWarning: { schemaVersion: 1, reasonCode: 'validation_response_invalid', message: '校驗模型回應格式無法辨識；請人工確認。', issues: [] } }; } },
    documentRef: env.document,
  });
  await flush();
  const bridge = new TauriTavernLiveTurnBridge({ root: env.host, queueLiveTurnAnalysis: app.queueLiveTurnAnalysis });
  const stop = bridge.start();
  [...env.listeners.get('received')][0](0, 'normal');
  await flush(); await flush(); await flush();
  const saved = await env.store.read();
  assert.equal(saved.state.batches.at(-1).status, 'review_ready');
  assert.equal(saved.state.committedBatchIds.length, 0);
  assert.equal(saved.state.batches.at(-1).validationWarning.reasonCode, 'validation_response_invalid');
  stop(); app.destroy(); env.destroy();
});
