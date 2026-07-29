import test from 'node:test';
import assert from 'node:assert/strict';

import { createEmptyAnalysisResult } from '../src/core/analysis-schema.js';
import { createChatState, migrateChatState } from '../src/core/chat-state.js';
import {
  beginTurnBatch,
  buildHandoffInjection,
  commitBatch,
  completeBatch,
  completeBatchAnalysis,
  consumeNextGeneration,
  detectNewMessages,
  failBatch,
  getBatch,
  getResumableBatch,
  prepareBatchHandoff,
  recordHandoffInjection,
  resolvePendingItem,
  retryBatch,
  startBatchCommit,
  undoLatestCommittedBatch,
  updateBatchHandoffDraft,
} from '../src/core/turn-sync.js';

const NOW = '2026-07-27T00:00:00.000Z';
const LATER = '2026-07-27T00:01:00.000Z';

function idFactory() {
  let count = 0;
  return (prefix) => `${prefix}-${++count}`;
}

function proposal(overrides = {}) {
  return {
    proposalId: 'proposal-1',
    kind: 'inventory',
    operation: 'add',
    value: { name: '測試物品', quantity: 1 },
    confidence: 0.95,
    evidenceMessageRef: 'message:m1|swipe:0|content:12345678',
    reason: '明確取得',
    severity: 'minor',
    dedupeKey: 'inventory:test-item:m1',
    ...overrides,
  };
}

function analysisWith(item, bucket = 'inventoryChanges') {
  const result = createEmptyAnalysisResult();
  result[bucket].push(item);
  result.evidence.push({
    messageRef: item.evidenceMessageRef,
    quote: '證據',
  });
  return result;
}

function messages({ swipeId = 0, content = '你得到一件測試物品。' } = {}) {
  return [
    {
      id: 'm1',
      is_user: false,
      mes: content,
      swipe_id: swipeId,
      send_date: NOW,
    },
  ];
}

function reviewState({
  batchId = 'batch-1',
  analysis = analysisWith(proposal()),
  source = 'turn',
} = {}) {
  let state = createChatState(NOW);
  state = beginTurnBatch(state, source === 'turn' ? messages() : [], {
    batchId,
    timestamp: NOW,
    source,
    correctionText: source === 'correction' ? '靈石應該是十九枚' : null,
  }).state;
  state = completeBatchAnalysis(state, batchId, analysis, NOW);
  return state;
}

function fullyCommit(state, batchId = 'batch-1') {
  const createId = idFactory();
  state = startBatchCommit(state, batchId, NOW);
  state = commitBatch(state, batchId, { timestamp: NOW, createId });
  state = prepareBatchHandoff(state, batchId, { timestamp: NOW, createId });
  state = completeBatch(state, batchId, NOW);
  return state;
}

test('同一 batchId 重複提交不會建立第二份正式事件', () => {
  let state = reviewState();
  const createId = idFactory();
  state = startBatchCommit(state, 'batch-1', NOW);
  state = commitBatch(state, 'batch-1', { timestamp: NOW, createId });
  const once = state;
  state = commitBatch(state, 'batch-1', { timestamp: LATER, createId });

  assert.equal(state.events.length, 1);
  assert.equal(state.testState.records.length, 1);
  assert.deepEqual(state, once);
});

test('failed 重試保留原 batchId、輸入與進度', () => {
  let state = createChatState(NOW);
  state = beginTurnBatch(state, messages(), {
    batchId: 'batch-retry',
    timestamp: NOW,
  }).state;
  const before = getBatch(state, 'batch-retry');
  state = failBatch(state, 'batch-retry', 'analysis', new Error('timeout'), NOW);
  state = retryBatch(state, 'batch-retry', LATER);
  const after = getBatch(state, 'batch-retry');

  assert.equal(after.batchId, 'batch-retry');
  assert.equal(after.status, 'analysis_pending');
  assert.equal(after.retryCount, 1);
  assert.deepEqual(after.inputMessages, before.inputMessages);
});

test('同一聊天訊息在成功同步後不會重複抽取', () => {
  let state = fullyCommit(reviewState());
  const detected = detectNewMessages(state, messages());

  assert.equal(state.sync.lastSuccessfulIndex, 0);
  assert.deepEqual(detected.messages, []);
});

test('Swipe 重抽保留同一訊息槽，不會重新套用替代內容', () => {
  const state = fullyCommit(reviewState());
  const rerolled = detectNewMessages(
    state,
    messages({ swipeId: 1, content: '替代 Swipe 內容' }),
  );

  assert.deepEqual(rerolled.messages, []);
  assert.equal(state.events.length, 1);
});

test('沒有穩定 ID 時使用可重現指紋並顯示限制', () => {
  const state = createChatState(NOW);
  const detected = detectNewMessages(state, [
    {
      is_user: true,
      mes: '訊息',
      send_date: NOW,
    },
  ]);

  assert.equal(detected.capability, 'reproducible_fingerprint');
  assert.match(detected.limitation, /可重現指紋/);
  assert.match(detected.messages[0].messageRef, /^fingerprint:/);
});

test('next_generation 在生成失敗時不消耗', () => {
  let state = createChatState(NOW);
  state.handoffItems.push({
    schemaVersion: 1,
    handoffId: 'handoff-1',
    batchId: 'batch-1',
    text: '保持位置一致',
    mode: 'next_generation',
    stateType: 'place',
    active: true,
    sourceEventIds: ['event-1'],
    lastInjectedGenerationId: null,
    consumedAt: null,
    replacedBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  });
  const injection = buildHandoffInjection(state);
  state = recordHandoffInjection(
    state,
    'generation-1',
    injection.itemIds,
    NOW,
  );
  state = consumeNextGeneration(state, 'generation-1', {
    saved: false,
    generationType: 'normal',
    timestamp: LATER,
  });

  assert.equal(state.handoffItems[0].active, true);
  assert.equal(state.handoffItems[0].consumedAt, null);
});

test('next_generation 在成功保存 assistant 回覆後消耗', () => {
  let state = createChatState(NOW);
  state.handoffItems.push({
    schemaVersion: 1,
    handoffId: 'handoff-1',
    batchId: 'batch-1',
    text: '保持位置一致',
    mode: 'next_generation',
    stateType: 'place',
    active: true,
    sourceEventIds: ['event-1'],
    lastInjectedGenerationId: 'generation-1',
    consumedAt: null,
    replacedBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  });
  state = consumeNextGeneration(state, 'generation-1', {
    saved: true,
    generationType: 'normal',
    timestamp: LATER,
  });

  assert.equal(state.handoffItems[0].active, false);
  assert.equal(state.handoffItems[0].consumedAt, LATER);
});

test('until_changed 會被相同狀態類型的新交接取代', () => {
  let state = reviewState();
  state.handoffItems.push({
    schemaVersion: 1,
    handoffId: 'handoff-old',
    batchId: 'batch-old',
    text: '舊物品狀態',
    mode: 'until_changed',
    stateType: 'inventory',
    active: true,
    sourceEventIds: ['event-old'],
    lastInjectedGenerationId: null,
    consumedAt: null,
    replacedBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  });
  state = updateBatchHandoffDraft(
    state,
    'batch-1',
    'handoff_proposal-1',
    { mode: 'until_changed', active: true },
    NOW,
  );
  const createId = idFactory();
  state = startBatchCommit(state, 'batch-1', NOW);
  state = commitBatch(state, 'batch-1', { timestamp: NOW, createId });
  state = prepareBatchHandoff(state, 'batch-1', { timestamp: LATER, createId });

  const oldItem = state.handoffItems.find(
    (item) => item.handoffId === 'handoff-old',
  );
  const newItem = state.handoffItems.find(
    (item) => item.batchId === 'batch-1',
  );
  assert.equal(oldItem.active, false);
  assert.equal(oldItem.replacedBy, newItem.handoffId);
  assert.equal(newItem.active, true);
  assert.equal(newItem.mode, 'until_changed');
});

test('待確認的拒絕只記錄決定，不修改正式測試狀態', () => {
  const majorPerson = proposal({
    proposalId: 'person-1',
    kind: 'person',
    operation: 'create',
    value: { name: '某同門', identityAmbiguous: true },
    severity: 'major',
    dedupeKey: 'person:someone',
  });
  let state = reviewState({
    analysis: analysisWith(majorPerson, 'personChanges'),
  });
  state = fullyCommit(state);
  assert.equal(state.pendingItems.length, 1);
  assert.equal(state.testState.records.length, 0);

  state = resolvePendingItem(state, state.pendingItems[0].pendingId, 'rejected', {
    batchId: 'batch-reject',
    timestamp: LATER,
  });

  assert.equal(state.pendingItems[0].status, 'rejected');
  assert.equal(state.testState.records.length, 0);
});

test('自然語言修正必須經最後確認才建立修正事件', () => {
  const currency = proposal({
    proposalId: 'currency-1',
    kind: 'currency',
    operation: 'set',
    value: { currency: '靈石', amount: 19 },
    evidenceMessageRef: 'correction:batch-correction',
    dedupeKey: 'currency:spirit-stone:set:19',
  });
  let state = reviewState({
    batchId: 'batch-correction',
    analysis: analysisWith(currency, 'currencyChanges'),
    source: 'correction',
  });

  assert.equal(getBatch(state, 'batch-correction').status, 'review_ready');
  assert.equal(state.testState.records.length, 0);

  state = fullyCommit(state, 'batch-correction');
  assert.equal(state.testState.records.length, 1);
  assert.equal(state.testState.records[0].value.amount, 19);
});

test('回憶中的故事時間保留於歷史，不覆蓋主線目前時間', () => {
  const memoryTime = proposal({
    proposalId: 'time-1',
    kind: 'story_time',
    operation: 'advance',
    value: { time: '第五日' },
    severity: 'minor',
    timelineContext: 'memory',
    dedupeKey: 'story-time:memory:day-5',
  });
  let state = reviewState({
    analysis: analysisWith(memoryTime, 'storyTimeChanges'),
  });
  const batch = getBatch(state, 'batch-1');

  assert.equal(batch.detectedChanges[0].reviewDisposition, 'apply');
  state = fullyCommit(state);
  assert.equal(state.testState.records.length, 1);
  assert.equal(state.pendingItems.length, 0);
  assert.equal(state.character.story.currentTime, null);
  assert.equal(state.character.story.timelineHistory[0].time, '第五日');
});

test('App 重開後可恢復 analysis_pending 未完成批次', () => {
  let state = createChatState(NOW);
  state = beginTurnBatch(state, messages(), {
    batchId: 'batch-resume',
    timestamp: NOW,
  }).state;
  const reopened = migrateChatState(
    JSON.parse(JSON.stringify(state)),
    LATER,
  ).state;
  const resumable = getResumableBatch(reopened);

  assert.equal(resumable.batchId, 'batch-resume');
  assert.equal(resumable.status, 'analysis_pending');
  assert.equal(resumable.inputMessages.length, 1);
});

test('撤銷最近批次使用軟刪除並保留恢復記錄', () => {
  let state = fullyCommit(reviewState());
  state = undoLatestCommittedBatch(state, {
    batchId: 'batch-undo',
    timestamp: LATER,
  });

  assert.equal(state.events[0].deletedAt, LATER);
  assert.equal(state.testState.records[0].deletedAt, LATER);
  assert.equal(getBatch(state, 'batch-1').revertedByBatchId, 'batch-undo');
  assert.equal(getBatch(state, 'batch-undo').outcome, 'reverted');
});
