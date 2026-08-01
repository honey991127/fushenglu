import {
  ANALYSIS_CHANGE_BUCKETS,
  assertAnalysisResult,
  createEmptyAnalysisResult,
} from './analysis-schema.js';
import { actionRequiresPending } from './character-state.js';
import { rebuildChatStateSnapshot } from './chat-state.js';
import { applyAnalysisPolicy } from './analysis-policy.js';
import { createFactKey } from './fact-key.js';
import { createEventId } from './event-id.js';
import {
  inspectProposalPayload,
} from './proposal-repair.js';
import { canonicalHandoffSections } from './snapshot-handoff.js';

export const BATCH_STATUSES = Object.freeze([
  'draft',
  'analysis_pending',
  'review_ready',
  'committing',
  'committed',
  'handoff_pending',
  'complete',
  'failed',
]);

export const HANDOFF_MODES = Object.freeze([
  'until_changed',
  'next_generation',
  'never',
]);

export const PENDING_KINDS = Object.freeze([
  'story_time',
  'inventory_currency',
  'wardrobe',
  'person',
  'place',
  'skill',
  'cultivation',
  'evaluation',
  'conflict',
  'other',
]);

const KIND_BUCKET = Object.freeze({
  story_time: 'storyTimeChanges',
  inventory: 'inventoryChanges',
  currency: 'currencyChanges',
  wardrobe: 'wardrobeChanges',
  skill: 'skillChanges',
  cultivation: 'cultivationChanges',
  person: 'personChanges',
  place: 'placeChanges',
  evaluation: 'evaluationChanges',
});

const KIND_PENDING = Object.freeze({
  story_time: 'story_time',
  inventory: 'inventory_currency',
  currency: 'inventory_currency',
  wardrobe: 'wardrobe',
  person: 'person',
  place: 'place',
  skill: 'skill',
  cultivation: 'cultivation',
  evaluation: 'evaluation',
  conflict: 'conflict',
  other: 'other',
});

function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function requireTimestamp(timestamp) {
  if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) {
    throw new TypeError('timestamp 必須是有效的 ISO 日期字串');
  }

  return timestamp;
}

function defaultId(prefix = 'id') {
  const uuid = globalThis.crypto?.randomUUID?.();

  if (uuid) {
    return `${prefix}_${uuid}`;
  }

  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function stateWithTimestamp(state, timestamp) {
  return {
    ...state,
    updatedAt: requireTimestamp(timestamp),
  };
}

function hashText(value) {
  const text = String(value);
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function normalizeRole(message) {
  if (message?.is_system || message?.role === 'system') {
    return null;
  }

  if (message?.is_user || message?.role === 'user') {
    return 'user';
  }

  if (
    message?.is_user === false ||
    message?.role === 'assistant' ||
    typeof message?.mes === 'string'
  ) {
    return 'assistant';
  }

  return null;
}

function normalizeContent(message) {
  if (typeof message?.mes === 'string') {
    return message.mes;
  }

  if (typeof message?.content === 'string') {
    return message.content;
  }

  return '';
}

function normalizeSpeakerName(message) {
  const name = message?.name ?? message?.speaker ?? message?.speaker_name ?? message?.extra?.speaker;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

export function buildIdentityContext(context = {}) {
  const character = Array.isArray(context.characters) && Number.isInteger(context.characterId)
    ? context.characters[context.characterId] : null;
  const playerName = [context.userName, context.user_name, context.name1, context.persona?.name].find((name) => typeof name === 'string' && name.trim()) ?? null;
  const cardName = [character?.name, context.name2, context.characterName].find((name) => typeof name === 'string' && name.trim()) ?? null;
  const groups = Array.isArray(context.groupMembers) ? context.groupMembers : Array.isArray(context.groups) ? context.groups : [];
  return {
    schemaVersion: 1,
    player: playerName ? { canonicalName: playerName.trim(), aliases: [playerName.trim()] } : null,
    cardCharacter: cardName ? { canonicalName: cardName.trim(), description: typeof character?.description === 'string' ? character.description : null } : null,
    groupMembers: groups.map((member) => typeof member === 'string' ? member : member?.name).filter((name) => typeof name === 'string' && name.trim()).map((name) => name.trim()),
  };
}

function stableMessageId(message) {
  const candidates = [
    message?.id,
    message?.messageId,
    message?.extra?.message_id,
    message?.extra?.messageId,
    message?.extra?.uuid,
  ];

  for (const candidate of candidates) {
    if (
      (typeof candidate === 'string' && candidate.trim() !== '') ||
      typeof candidate === 'number'
    ) {
      return String(candidate);
    }
  }

  return null;
}

function normalizeSwipeId(message) {
  const swipeId = message?.swipe_id ?? message?.swipeId;

  if (
    typeof swipeId === 'number' ||
    (typeof swipeId === 'string' && swipeId.trim() !== '')
  ) {
    return String(swipeId);
  }

  return null;
}

export function normalizeChatMessages(rawMessages = []) {
  if (!Array.isArray(rawMessages)) {
    throw new TypeError('聊天訊息必須是陣列');
  }

  let usedFingerprint = false;
  let usedIndexFallback = false;
  const messages = [];

  rawMessages.forEach((message, index) => {
    const role = normalizeRole(message);

    if (!role) {
      return;
    }

    const content = normalizeContent(message);
    const stableId = stableMessageId(message);
    const swipeId = normalizeSwipeId(message);
    const sentAt =
      typeof message?.send_date === 'string'
        ? message.send_date
        : typeof message?.sendDate === 'string'
          ? message.sendDate
          : null;
    let slotKey;
    let referenceMethod;

    if (stableId) {
      slotKey = `message:${stableId}`;
      referenceMethod = 'stable_message_id';
    } else if (sentAt) {
      slotKey = `fingerprint:${hashText(`${role}|${sentAt}|${message?.name ?? ''}`)}`;
      referenceMethod = 'reproducible_fingerprint';
      usedFingerprint = true;
    } else {
      slotKey = `index:${index}`;
      referenceMethod = 'index_fallback';
      usedIndexFallback = true;
    }

    const fingerprint = hashText(
      `${role}|${content.replace(/\s+/g, ' ').trim()}|${sentAt ?? ''}`,
    );
    const messageRef = [
      slotKey,
      swipeId === null ? null : `swipe:${swipeId}`,
      `content:${fingerprint}`,
    ]
      .filter(Boolean)
      .join('|');

    messages.push({
      schemaVersion: 1,
      index,
      role,
      speakerName: normalizeSpeakerName(message),
      content,
      stableMessageId: stableId,
      swipeId,
      sentAt,
      slotKey,
      fingerprint,
      messageRef,
      referenceMethod,
    });
  });

  const capability = usedIndexFallback
    ? 'index_fallback'
    : usedFingerprint
      ? 'reproducible_fingerprint'
      : 'stable_message_id';
  const limitation =
    capability === 'stable_message_id'
      ? null
      : capability === 'reproducible_fingerprint'
        ? '宿主未提供穩定 message ID；目前使用可重現指紋，跨裝置匯入或時間戳變動時需人工核對。'
        : '宿主未提供穩定 message ID 或時間戳；只能使用訊息位置，編輯、刪除或分支重排後需人工核對。';

  return {
    schemaVersion: 1,
    messages,
    capability,
    limitation,
    branchFingerprint: hashText(
      messages.map((message) => message.messageRef).join('\n'),
    ),
  };
}

export function detectNewMessages(state, rawMessages) {
  const normalized = normalizeChatMessages(rawMessages);
  const processed = new Set(state.sync?.processedSlotKeys ?? []);
  const ignored = new Set(state.sync?.ignoredSlotKeys ?? []);
  const messages = normalized.messages.filter(
    (message) => !processed.has(message.slotKey) && !ignored.has(message.slotKey),
  );

  return {
    ...normalized,
    messages,
  };
}

function statusEntry(status, timestamp, note = null) {
  return {
    schemaVersion: 1,
    status,
    at: timestamp,
    note,
  };
}

function transitionBatch(batch, status, timestamp, note = null) {
  if (!BATCH_STATUSES.includes(status)) {
    throw new TypeError(`不合法批次狀態：${status}`);
  }

  return {
    ...batch,
    status,
    updatedAt: timestamp,
    statusHistory: [
      ...(batch.statusHistory ?? []),
      statusEntry(status, timestamp, note),
    ],
  };
}

function replaceBatch(state, batch) {
  return {
    ...state,
    batches: state.batches.map((item) =>
      item.batchId === batch.batchId ? batch : item,
    ),
  };
}

export function getBatch(state, batchId) {
  return state.batches.find((batch) => batch.batchId === batchId) ?? null;
}

function requireBatch(state, batchId) {
  const batch = getBatch(state, batchId);

  if (!batch) {
    throw new Error(`找不到批次 ${batchId}`);
  }

  return batch;
}

export function createDraftTestAction(
  value,
  {
    actionId = defaultId('action'),
    timestamp = new Date().toISOString(),
  } = {},
) {
  const normalized = String(value ?? '').trim();

  if (!normalized) {
    throw new TypeError('測試操作內容不可為空');
  }

  return {
    schemaVersion: 1,
    actionId,
    kind: 'test_action',
    operation: 'record',
    value: normalized,
    dedupeKey: `test_action:${hashText(normalized)}`,
    selected: true,
    createdAt: requireTimestamp(timestamp),
  };
}

export function addDraftAction(state, action, timestamp = new Date().toISOString()) {
  if (!action || ![1, 2].includes(action.schemaVersion) || typeof action.actionId !== 'string') {
    throw new TypeError('暫存操作格式無效');
  }

  return stateWithTimestamp(
    {
      ...state,
      draftActions: [...state.draftActions, clone(action)],
    },
    timestamp,
  );
}

export function beginTurnBatch(
  state,
  rawMessages,
  {
    batchId = defaultId('batch'),
    timestamp = new Date().toISOString(),
    source = 'turn',
    correctionText = null,
    forceAllMessages = false,
    identityContext = null,
  } = {},
) {
  requireTimestamp(timestamp);

  if (getBatch(state, batchId)) {
    return {
      state,
      batch: getBatch(state, batchId),
    };
  }

  const detected =
    source === 'correction'
      ? {
          schemaVersion: 1,
          messages: [],
          capability: state.sync.capability,
          limitation: state.sync.limitation,
          branchFingerprint: state.sync.branchFingerprint ?? '',
        }
      : forceAllMessages
        ? normalizeChatMessages(rawMessages)
        : detectNewMessages(state, rawMessages);
  const draft = {
    schemaVersion: 1,
    batchId,
    source,
    status: 'draft',
    statusHistory: [statusEntry('draft', timestamp)],
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    outcome: null,
    correctionText,
    inputMessages: clone(detected.messages),
    identityContext: clone(identityContext ?? { schemaVersion: 1, player: null, cardCharacter: null, groupMembers: [] }),
    inputSlotKeys: detected.messages.map((message) => message.slotKey),
    sourceMessageRefs: detected.messages.map((message) => message.messageRef),
    branchFingerprint: detected.branchFingerprint,
    referenceCapability: detected.capability,
    referenceLimitation: detected.limitation,
    draftActions: clone(state.draftActions),
    detectedChanges: [],
    uncertainItems: [],
    evidence: [],
    handoffDrafts: [],
    acceptedProposalIds: [],
    rejectedProposalIds: [],
    committedEventIds: [],
    pendingItemIds: [],
    failurePhase: null,
    failureMessage: null,
    retryCount: 0,
    revertedByBatchId: null,
    deletedAt: null,
  };
  const pending = transitionBatch(draft, 'analysis_pending', timestamp);
  const nextState = stateWithTimestamp(
    {
      ...state,
      draftActions: [],
      batches: [...state.batches, pending],
      sync: {
        ...state.sync,
        capability: detected.capability,
        limitation: detected.limitation,
        branchFingerprint: detected.branchFingerprint,
      },
    },
    timestamp,
  );

  return {
    state: nextState,
    batch: pending,
  };
}

function consolidateReviewItems(items, sourceMessageRefs) {
  const latest = new Map();
  items.forEach((item, index) => {
    const sourceMessageIndex = Number.isInteger(item.evidence.messageIndex)
      ? item.evidence.messageIndex
      : sourceMessageRefs.indexOf(item.evidence.messageRef);
    const enriched = { ...item, sourceMessageIndex: sourceMessageIndex < 0 ? index : sourceMessageIndex };
    const identity = enriched.factKey + ':' + enriched.operation;
    const current = latest.get(identity);
    if (!current || enriched.evidence.evidenceOrder >= current.evidence.evidenceOrder) latest.set(identity, enriched);
  });
  return [...latest.values()];
}

function createReviewItem(classified) {
  const candidate = classified;
  const legacyKind = candidate.kind === 'person_state' ? 'person' : candidate.kind;
  const reviewDisposition = candidate.disposition === 'apply' ? 'apply' : candidate.disposition === 'pending' ? 'pending' : 'reject';
  return {
    schemaVersion: 1,
    proposalId: candidate.modelProposalId ?? 'policy_' + candidate.factKey,
    kind: legacyKind,
    operation: candidate.operation,
    value: clone(candidate.normalizedValue),
    confidence: candidate.confidence,
    evidenceMessageRef: candidate.evidence.messageRef,
    evidenceQuote: candidate.evidence.quote,
    evidenceOrder: candidate.evidence.evidenceOrder,
    subjectEntityId: candidate.subjectRef.entityId,
    timelineContext: candidate.timelineContext,
    reason: candidate.reasonCode,
    severity: 'minor',
    dedupeKey: candidate.factKey,
    factKey: candidate.factKey,
    originBucket: candidate.originBucket,
    policyDisposition: candidate.disposition,
    reasonCode: candidate.reasonCode,
    requiresPlayerDecision: candidate.requiresPlayerDecision,
    reviewDisposition,
    editedByPlayer: false,
  };
}

function handoffTextFor(proposal) {
  const value = proposal.value;

  if (proposal.kind === 'currency' && value && typeof value === 'object') {
    const name = value.name ?? value.currency ?? '未命名貨幣';
    const amount = value.amount ?? value.quantity ?? value.value ?? 0;
    const operation =
      proposal.operation === 'add'
        ? '增加'
        : proposal.operation === 'subtract'
          ? '減少'
          : '設定為';
    return `貨幣：${name} ${operation} ${amount}`;
  }

  if (proposal.kind === 'inventory' && value && typeof value === 'object') {
    const name = value.name ?? '未命名物品';
    const amount = value.quantity ?? value.amount ?? value.value ?? 0;
    return `物品：${name} ${proposal.operation} ${amount}`;
  }

  const textValue =
    typeof value === 'string' ? value : JSON.stringify(value);
  return `${proposal.kind} 狀態：${textValue}`;
}

function handoffEligible(item) {
  return (
    ['currency', 'inventory', 'cultivation'].includes(item.kind) ||
    (item.kind === 'wardrobe' && item.operation === 'wear') ||
    (item.kind === 'other' && item.operation === 'set_status')
  );
}

function handoffDraftFor(item, source = 'proposal') {
  return {
    schemaVersion: 1,
    draftId: `handoff_${item.proposalId ?? item.actionId}`,
    text: handoffTextFor(item),
    mode: 'next_generation',
    stateType: item.kind,
    sourceProposalIds: source === 'proposal' ? [item.proposalId] : [],
    sourceActionIds: source === 'action' ? [item.actionId] : [],
    active: handoffEligible(item) && (item.reviewDisposition ?? 'apply') === 'apply',
  };
}

export function completeBatchAnalysis(
  state,
  batchId,
  result,
  timestamp = new Date().toISOString(),
) {
  const analysis = assertAnalysisResult(result);
  const batch = requireBatch(state, batchId);

  if (!['analysis_pending', 'failed'].includes(batch.status)) {
    throw new Error(`批次 ${batchId} 目前不可寫入分析結果`);
  }

  const classified = applyAnalysisPolicy(analysis, state, { identityContext: batch.identityContext });
  const reviewItems = consolidateReviewItems(classified, batch.sourceMessageRefs).map(createReviewItem);
  const detectedChanges = reviewItems.filter((item) => item.policyDisposition !== 'pending');
  const uncertainItems = reviewItems.filter((item) => item.policyDisposition === 'pending');
  const handoffDrafts = [
    ...[...detectedChanges, ...uncertainItems].map((item) => handoffDraftFor(item)),
    ...batch.draftActions.map((action) => handoffDraftFor(action, 'action')),
  ];
  const ready = transitionBatch(
    {
      ...batch,
      detectedChanges,
      uncertainItems,
      evidence: clone(analysis.evidence),
      handoffDrafts,
      failurePhase: null,
      failureMessage: null,
    },
    'review_ready',
    requireTimestamp(timestamp),
  );

  return stateWithTimestamp(replaceBatch(state, ready), timestamp);
}

export function refreshBatchAnalysis(
  state,
  batchId,
  result,
  timestamp = new Date().toISOString(),
) {
  const analysis = assertAnalysisResult(result);
  const batch = requireBatch(state, batchId);

  if (batch.status !== 'review_ready') {
    throw new Error('只有 review_ready 批次可以刷新分析預覽');
  }

  const previousItems = new Map(
    [...batch.detectedChanges, ...batch.uncertainItems].map((item) => [
      item.proposalId,
      item,
    ]),
  );
  const previousDrafts = new Map(
    batch.handoffDrafts.map((draft) => [draft.draftId, draft]),
  );
  const preserveReview = (item) => {
    const previous = previousItems.get(item.proposalId);

    if (!previous) {
      return item;
    }

    return {
      ...item,
      reviewDisposition:
        item.uncertain && previous.reviewDisposition !== 'reject'
          ? 'pending'
          : previous.reviewDisposition,
      editedByPlayer: previous.editedByPlayer,
    };
  };
  const detectedChanges = ANALYSIS_CHANGE_BUCKETS.flatMap((bucket) =>
    analysis[bucket].map((proposal) =>
      preserveReview(createReviewItem(proposal, bucket, false)),
    ),
  );
  const uncertainItems = analysis.uncertainItems.map((proposal) =>
    preserveReview(
      createReviewItem(proposal, 'uncertainItems', true),
    ),
  );
  const handoffDrafts = [
    ...[...detectedChanges, ...uncertainItems].map((item) => {
      const fresh = handoffDraftFor(item);
      const previous = previousDrafts.get(fresh.draftId);

      return previous
        ? {
            ...fresh,
            text: previous.text,
            mode: previous.mode,
            active:
              fresh.active &&
              previous.active &&
              previous.mode !== 'never',
          }
        : fresh;
    }),
    ...batch.draftActions.map((action) => handoffDraftFor(action, 'action')),
  ];
  const refreshed = {
    ...batch,
    detectedChanges,
    uncertainItems,
    evidence: clone(analysis.evidence),
    handoffDrafts,
    updatedAt: requireTimestamp(timestamp),
  };

  return stateWithTimestamp(
    replaceBatch(state, refreshed),
    timestamp,
  );
}

export function failBatch(
  state,
  batchId,
  phase,
  error,
  timestamp = new Date().toISOString(),
) {
  if (!['analysis', 'commit', 'handoff'].includes(phase)) {
    throw new TypeError(`未知失敗階段：${phase}`);
  }

  const batch = requireBatch(state, batchId);
  const message = error instanceof Error ? error.message : String(error);
  const failed = transitionBatch(
    {
      ...batch,
      failurePhase: phase,
      failureMessage: message.slice(0, 1000),
    },
    'failed',
    requireTimestamp(timestamp),
    `${phase} failed`,
  );

  return stateWithTimestamp(replaceBatch(state, failed), timestamp);
}

export function retryBatch(
  state,
  batchId,
  timestamp = new Date().toISOString(),
) {
  const batch = requireBatch(state, batchId);

  if (batch.status !== 'failed') {
    throw new Error('只有 failed 批次可以重試');
  }

  const retryStatus =
    batch.failurePhase === 'commit'
      ? 'committing'
      : batch.failurePhase === 'handoff'
        ? 'handoff_pending'
        : 'analysis_pending';
  const retried = transitionBatch(
    {
      ...batch,
      retryCount: batch.retryCount + 1,
      failureMessage: null,
    },
    retryStatus,
    requireTimestamp(timestamp),
    `retry ${batch.retryCount + 1}`,
  );

  return stateWithTimestamp(replaceBatch(state, retried), timestamp);
}

export function recoverCertainActionsOnly(
  state,
  batchId,
  timestamp = new Date().toISOString(),
) {
  const batch = requireBatch(state, batchId);

  if (batch.status !== 'failed' || batch.failurePhase !== 'analysis') {
    throw new Error('只有分析失敗批次可改為只提交確定操作');
  }

  return completeBatchAnalysis(
    state,
    batchId,
    createEmptyAnalysisResult(),
    timestamp,
  );
}

function validateEditedProposal(item) {
  if (item.actionId) {
    return;
  }

  const analysis = createEmptyAnalysisResult();
  const proposal = Object.fromEntries(
    Object.entries(item).filter(
      ([key]) =>
        ![
          'schemaVersion',
          'originBucket',
          'uncertain',
          'reviewDisposition',
          'editedByPlayer',
        ].includes(key),
    ),
  );

  if (item.originBucket === 'uncertainItems') {
    analysis.uncertainItems.push(proposal);
  } else {
    const bucket = KIND_BUCKET[proposal.kind];

    if (!bucket) {
      analysis.uncertainItems.push(proposal);
    } else {
      analysis[bucket].push(proposal);
    }
  }

  assertAnalysisResult(analysis);
}

export function updateBatchProposal(
  state,
  batchId,
  proposalId,
  updates,
  timestamp = new Date().toISOString(),
) {
  const batch = requireBatch(state, batchId);

  if (batch.status !== 'review_ready') {
    throw new Error('只有 review_ready 批次可修改候選');
  }

  const allowedDispositions = ['apply', 'pending', 'reject'];
  const updateItems = (items) =>
    items.map((item) => {
      if (item.proposalId !== proposalId) {
        return item;
      }

      const next = {
        ...item,
        ...clone(updates),
        proposalId: item.proposalId,
        editedByPlayer: true,
      };

      if (!allowedDispositions.includes(next.reviewDisposition)) {
        throw new TypeError('候選處理方式必須是 apply、pending 或 reject');
      }

      validateEditedProposal(next);
      return next;
    });
  const updatedBatch = {
    ...batch,
    detectedChanges: updateItems(batch.detectedChanges),
    uncertainItems: updateItems(batch.uncertainItems),
    updatedAt: requireTimestamp(timestamp),
  };

  return stateWithTimestamp(replaceBatch(state, updatedBatch), timestamp);
}

export function updateBatchHandoffDraft(
  state,
  batchId,
  draftId,
  updates,
  timestamp = new Date().toISOString(),
) {
  const batch = requireBatch(state, batchId);

  if (!['review_ready', 'failed'].includes(batch.status)) {
    throw new Error('目前批次不可修改交接預覽');
  }

  const handoffDrafts = batch.handoffDrafts.map((draft) => {
    if (draft.draftId !== draftId) {
      return draft;
    }

    const next = {
      ...draft,
      ...clone(updates),
      draftId: draft.draftId,
    };

    if (typeof next.text !== 'string') {
      throw new TypeError('交接文字必須是字串');
    }

    if (!HANDOFF_MODES.includes(next.mode)) {
      throw new TypeError('交接模式無效');
    }

    next.active = Boolean(next.active) && next.mode !== 'never';
    return next;
  });
  const updatedBatch = {
    ...batch,
    handoffDrafts,
    updatedAt: requireTimestamp(timestamp),
  };

  return stateWithTimestamp(replaceBatch(state, updatedBatch), timestamp);
}

function markInputSlots(state, batch, ignored) {
  const targetField = ignored ? 'ignoredSlotKeys' : 'processedSlotKeys';
  const merged = [
    ...new Set([
      ...(state.sync[targetField] ?? []),
      ...batch.inputSlotKeys,
    ]),
  ];
  const maxIndex = Math.max(
    state.sync.lastSuccessfulIndex ?? -1,
    ...batch.inputMessages.map((message) => message.index),
  );

  return {
    ...state,
    sync: {
      ...state.sync,
      [targetField]: merged,
      ...(ignored ? {} : { lastSuccessfulIndex: maxIndex }),
    },
  };
}

export function cancelBatch(
  state,
  batchId,
  timestamp = new Date().toISOString(),
) {
  const batch = requireBatch(state, batchId);

  if (['committed', 'handoff_pending'].includes(batch.status)) {
    throw new Error('已提交批次不可取消，請使用撤銷');
  }

  if (batch.status === 'complete') {
    return state;
  }

  const completed = transitionBatch(
    {
      ...batch,
      outcome: 'cancelled',
      completedAt: requireTimestamp(timestamp),
    },
    'complete',
    timestamp,
    'cancelled before commit',
  );
  const next = markInputSlots(replaceBatch(state, completed), batch, true);
  return stateWithTimestamp(next, timestamp);
}

export function startBatchCommit(
  state,
  batchId,
  timestamp = new Date().toISOString(),
) {
  const batch = requireBatch(state, batchId);

  if (state.committedBatchIds.includes(batchId)) {
    return state;
  }

  if (batch.status !== 'review_ready') {
    throw new Error('只有 review_ready 批次可以最後確認');
  }

  const committing = transitionBatch(
    batch,
    'committing',
    requireTimestamp(timestamp),
  );
  return stateWithTimestamp(replaceBatch(state, committing), timestamp);
}

function sourceEvent(batch, item, _eventId, timestamp, sourceType = 'analysis') {
  const sourceMessageIndex = Number.isInteger(item.sourceMessageIndex) ? item.sourceMessageIndex : 0;
  const sourceMessageRef = item.evidenceMessageRef ?? batch.sourceMessageRefs[sourceMessageIndex] ?? null;
  const subjectEntityId = item.subjectEntityId ?? item.value?.subjectEntityId ?? item.value?.ownerEntityId ?? null;
  const factKey = createFactKey({ kind: item.kind === 'person' ? 'person_state' : item.kind, operation: item.operation, subjectRef: { entityId: subjectEntityId }, value: item.value });
  const evidenceOrder = Number.isInteger(item.evidenceOrder) ? item.evidenceOrder : 0;
  return {
    schemaVersion: 2,
    eventId: createEventId({ messageRef: sourceMessageRef, messageIndex: sourceMessageIndex, evidenceOrder, kind: item.kind, operation: item.operation, subjectEntityId, factKey }),
    batchId: batch.batchId, sourceType, sourceProposalId: item.proposalId ?? null, sourceActionId: item.actionId ?? null,
    sourceMessageRefs: [...batch.sourceMessageRefs], sourceMessageRef, sourceMessageIndex,
    storyOrder: sourceMessageIndex, sourceOrder: { messageIndex: sourceMessageIndex, evidenceOrder }, evidenceQuote: item.evidenceQuote ?? null,
    timelineContext: item.timelineContext ?? 'main', subjectEntityId, factKey, kind: item.kind, operation: item.operation,
    value: clone(item.value), dedupeKey: factKey, createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
  };
}

function pendingFromProposal(batch, item, pendingId, timestamp) {
  return {
    schemaVersion: 1,
    pendingId,
    batchId: batch.batchId,
    kind: KIND_PENDING[item.kind] ?? 'other',
    proposal: clone(item),
    evidence: batch.evidence.filter(
      (evidence) => evidence.messageRef === item.evidenceMessageRef,
    ),
    status: 'pending',
    decisionHistory: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
}

function testRecordForEvent(event, recordId, timestamp) {
  return {
    schemaVersion: 1,
    recordId,
    eventId: event.eventId,
    batchId: event.batchId,
    kind: event.kind,
    operation: event.operation,
    value: clone(event.value),
    dedupeKey: event.dedupeKey,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
}

export function commitBatch(
  state,
  batchId,
  {
    timestamp = new Date().toISOString(),
    createId = defaultId,
  } = {},
) {
  requireTimestamp(timestamp);

  if (state.committedBatchIds.includes(batchId)) {
    return state;
  }

  const batch = requireBatch(state, batchId);

  if (batch.status !== 'committing') {
    throw new Error('只有 committing 批次可以寫入正式資料');
  }

  const existingDedupeKeys = new Set(
    state.events
      .filter((event) => event.deletedAt === null)
      .map((event) => event.factKey),
  );
  const newEvents = [];
  const newRecords = [];
  const newPending = [];
  const acceptedProposalIds = [];
  const rejectedProposalIds = [];
  const pendingItemIds = [];
  const allReviewItems = [...batch.detectedChanges, ...batch.uncertainItems];

  for (const action of batch.draftActions) {
    if (!action.selected) {
      continue;
    }

    const inspected = inspectProposalPayload(action);
    const commitAction = {
      ...action,
      ...inspected.proposal,
      payloadIssues: [...inspected.issues],
    };

    if (existingDedupeKeys.has(createFactKey({ kind: commitAction.kind, operation: commitAction.operation, subjectRef: { entityId: commitAction.subjectEntityId }, value: commitAction.value }))) {
      continue;
    }

    if (!inspected.complete || actionRequiresPending(state, commitAction)) {
      const pendingId = createId('pending');
      newPending.push(
        pendingFromProposal(batch, commitAction, pendingId, timestamp),
      );
      pendingItemIds.push(pendingId);
      continue;
    }

    const event = sourceEvent(
      batch,
      commitAction,
      createId('event'),
      timestamp,
      'plugin_action',
    );
    newEvents.push(event);
    newRecords.push(testRecordForEvent(event, createId('record'), timestamp));
    existingDedupeKeys.add(createFactKey({ kind: commitAction.kind, operation: commitAction.operation, subjectRef: { entityId: commitAction.subjectEntityId }, value: commitAction.value }));
  }

  for (const item of allReviewItems) {
    if (item.reviewDisposition === 'reject') {
      rejectedProposalIds.push(item.proposalId);
      continue;
    }

    const inspected = inspectProposalPayload(item);
    const commitItem = {
      ...item,
      ...inspected.proposal,
      payloadIssues: [...inspected.issues],
    };

    if (item.reviewDisposition === 'pending' || !inspected.complete) {
      const pendingId = createId('pending');
      newPending.push(
        pendingFromProposal(batch, commitItem, pendingId, timestamp),
      );
      pendingItemIds.push(pendingId);
      continue;
    }

    if (existingDedupeKeys.has(commitItem.factKey ?? createFactKey({ kind: commitItem.kind, operation: commitItem.operation, subjectRef: { entityId: commitItem.subjectEntityId }, value: commitItem.value }))) {
      rejectedProposalIds.push(commitItem.proposalId);
      continue;
    }

    const event = sourceEvent(batch, commitItem, createId('event'), timestamp);
    newEvents.push(event);
    newRecords.push(testRecordForEvent(event, createId('record'), timestamp));
    acceptedProposalIds.push(commitItem.proposalId);
    existingDedupeKeys.add(commitItem.factKey ?? createFactKey({ kind: commitItem.kind, operation: commitItem.operation, subjectRef: { entityId: commitItem.subjectEntityId }, value: commitItem.value }));
  }

  const committed = transitionBatch(
    {
      ...batch,
      acceptedProposalIds,
      rejectedProposalIds,
      committedEventIds: newEvents.map((event) => event.eventId),
      pendingItemIds,
      failurePhase: null,
      failureMessage: null,
    },
    'committed',
    timestamp,
  );
  const next = replaceBatch(
    {
      ...state,
      events: [...state.events, ...newEvents],
      pendingItems: [...state.pendingItems, ...newPending],
      pendingDecisionRecords: [...(state.pendingDecisionRecords ?? []), ...newPending.map((pending) => ({ schemaVersion: 1, pendingId: pending.pendingId, reasonCode: pending.reasonCode, proposal: clone(pending.proposal), createdAt: pending.createdAt }))],
      committedBatchIds: [...state.committedBatchIds, batchId],
      testState: {
        ...state.testState,
        records: [...state.testState.records, ...newRecords],
        updatedAt: timestamp,
      },
    },
    committed,
  );
  return stateWithTimestamp(
    {
      ...next,
      ...rebuildChatStateSnapshot(next),
    },
    timestamp,
  );
}

function canonicalHandoffItems(state, batchId, timestamp) {
  return canonicalHandoffSections(state.currentSnapshot).map(([section, text]) => ({
    schemaVersion: 1,
    handoffId: `handoff:${section}`,
    batchId,
    text,
    mode: 'until_changed',
    stateType: section,
    active: true,
    sourceEventIds: [...state.eventLedger.eventIds],
    lastInjectedGenerationId: null,
    consumedAt: null,
    replacedBy: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  }));
}

export function prepareBatchHandoff(
  state,
  batchId,
  {
    timestamp = new Date().toISOString(),
    createId = defaultId,
  } = {},
) {
  const batch = requireBatch(state, batchId);

  if (batch.status === 'handoff_pending') {
    return state;
  }

  if (batch.status !== 'committed') {
    throw new Error('只有 committed 批次可以準備交接');
  }

  const handoffItems = canonicalHandoffItems(state, batchId, timestamp);
  const pending = transitionBatch(batch, 'handoff_pending', timestamp);
  return stateWithTimestamp(replaceBatch({ ...state, handoffItems }, pending), timestamp);
  /* legacy proposal/draft compatibility only; not a formal handoff source.
  const eventByProposal = new Map(
    state.events
      .filter((event) => event.batchId === batchId && event.sourceProposalId)
      .map((event) => [event.sourceProposalId, event.eventId]),
  );
  const eventByAction = new Map(
    state.events
      .filter((event) => event.batchId === batchId && event.sourceActionId)
      .map((event) => [event.sourceActionId, event.eventId]),
  );
  const confirmed = new Set(batch.acceptedProposalIds);
  const handoffItems = clone(state.handoffItems);

  for (const draft of batch.handoffDrafts) {
    const sourceProposalIds = (draft.sourceProposalIds ?? []).filter((proposalId) =>
      confirmed.has(proposalId),
    );
    const sourceActionIds = (draft.sourceActionIds ?? []).filter((actionId) =>
      eventByAction.has(actionId),
    );

    if (
      !draft.active ||
      draft.mode === 'never' ||
      sourceProposalIds.length + sourceActionIds.length === 0
    ) {
      continue;
    }

    const handoffId = createId('handoff');
    const item = {
      schemaVersion: 1,
      handoffId,
      batchId,
      text: draft.text.trim(),
      mode: draft.mode,
      stateType: draft.stateType,
      active: Boolean(draft.text.trim()),
      sourceEventIds: sourceProposalIds
        .map((proposalId) => eventByProposal.get(proposalId))
        .concat(sourceActionIds.map((actionId) => eventByAction.get(actionId)))
        .filter(Boolean),
      lastInjectedGenerationId: null,
      consumedAt: null,
      replacedBy: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };

    if (item.mode === 'until_changed') {
      for (let index = 0; index < handoffItems.length; index += 1) {
        const previous = handoffItems[index];

        if (
          previous.active &&
          previous.mode === 'until_changed' &&
          previous.stateType === item.stateType
        ) {
          handoffItems[index] = {
            ...previous,
            active: false,
            replacedBy: handoffId,
            updatedAt: timestamp,
          };
        }
      }
    }

    handoffItems.push(item);
  }

  const pending = transitionBatch(batch, 'handoff_pending', timestamp);
  return stateWithTimestamp(
    replaceBatch({ ...state, handoffItems }, pending),
    timestamp,
  ); */
}

export function completeBatch(
  state,
  batchId,
  timestamp = new Date().toISOString(),
) {
  const batch = requireBatch(state, batchId);

  if (batch.status === 'complete') {
    return state;
  }

  if (batch.status !== 'handoff_pending') {
    throw new Error('只有 handoff_pending 批次可以完成');
  }

  const completed = transitionBatch(
    {
      ...batch,
      outcome: 'committed',
      completedAt: requireTimestamp(timestamp),
    },
    'complete',
    timestamp,
  );
  const next = markInputSlots(replaceBatch(state, completed), batch, false);
  return stateWithTimestamp(next, timestamp);
}

export function buildHandoffInjection(state) {
  const items = state.handoffItems.filter(
    (item) =>
      item.active &&
      item.deletedAt === null &&
      ['until_changed', 'next_generation'].includes(item.mode),
  );

  if (items.length === 0) {
    return {
      text: '',
      itemIds: [],
    };
  }

  return {
    text: [
      '[浮生錄一致性提示]',
      '請保持以下已確認狀態一致；不必主動重述已完成的操作。',
      ...items.map((item) => `- ${item.text}`),
    ].join('\n'),
    itemIds: items.map((item) => item.handoffId),
  };
}

export function recordHandoffInjection(
  state,
  generationId,
  itemIds,
  timestamp = new Date().toISOString(),
) {
  if (typeof generationId !== 'string' || generationId.trim() === '') {
    throw new TypeError('generationId 不可為空');
  }

  const selected = new Set(itemIds);
  const handoffItems = state.handoffItems.map((item) =>
    selected.has(item.handoffId) && item.active
      ? {
          ...item,
          lastInjectedGenerationId: generationId,
          updatedAt: requireTimestamp(timestamp),
        }
      : item,
  );

  return stateWithTimestamp({ ...state, handoffItems }, timestamp);
}

export function consumeNextGeneration(
  state,
  generationId,
  {
    saved,
    generationType = 'normal',
    timestamp = new Date().toISOString(),
  } = {},
) {
  if (
    !saved ||
    ['swipe', 'regenerate', 'quiet', 'impersonate'].includes(generationType)
  ) {
    return state;
  }

  const handoffItems = state.handoffItems.map((item) =>
    item.active &&
    item.mode === 'next_generation' &&
    item.lastInjectedGenerationId === generationId
      ? {
          ...item,
          active: false,
          consumedAt: requireTimestamp(timestamp),
          updatedAt: timestamp,
        }
      : item,
  );

  return stateWithTimestamp({ ...state, handoffItems }, timestamp);
}

export function updateHandoffItem(
  state,
  handoffId,
  updates,
  timestamp = new Date().toISOString(),
) {
  const handoffItems = state.handoffItems.map((item) => {
    if (item.handoffId !== handoffId) {
      return item;
    }

    const next = {
      ...item,
      ...clone(updates),
      handoffId: item.handoffId,
      updatedAt: requireTimestamp(timestamp),
    };

    if (typeof next.text !== 'string') {
      throw new TypeError('交接文字必須是字串');
    }

    if (!HANDOFF_MODES.includes(next.mode)) {
      throw new TypeError('交接模式無效');
    }

    next.active = Boolean(next.active) && next.mode !== 'never';
    return next;
  });

  return stateWithTimestamp({ ...state, handoffItems }, timestamp);
}

function resolutionBatch(batchId, pending, decision, timestamp) {
  return {
    schemaVersion: 1,
    batchId,
    source: 'pending_resolution',
    status: 'complete',
    statusHistory: [
      statusEntry('draft', timestamp),
      statusEntry('analysis_pending', timestamp),
      statusEntry('review_ready', timestamp),
      statusEntry('committing', timestamp),
      statusEntry('committed', timestamp),
      statusEntry('handoff_pending', timestamp),
      statusEntry('complete', timestamp),
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: timestamp,
    outcome: decision,
    correctionText: null,
    inputMessages: [],
    inputSlotKeys: [],
    sourceMessageRefs: [],
    branchFingerprint: '',
    referenceCapability: 'stable_message_id',
    referenceLimitation: null,
    draftActions: [],
    detectedChanges: [],
    uncertainItems: [],
    evidence: clone(pending.evidence),
    handoffDrafts: [],
    acceptedProposalIds: decision === 'accepted' ? [pending.proposal.proposalId] : [],
    rejectedProposalIds: decision === 'rejected' ? [pending.proposal.proposalId] : [],
    committedEventIds: [],
    pendingItemIds: [pending.pendingId],
    failurePhase: null,
    failureMessage: null,
    retryCount: 0,
    revertedByBatchId: null,
    deletedAt: null,
  };
}

export function resolvePendingItem(
  state,
  pendingId,
  decision,
  {
    batchId = defaultId('batch'),
    editedProposal = null,
    timestamp = new Date().toISOString(),
    createId = defaultId,
  } = {},
) {
  if (!['accepted', 'rejected', 'edited', 'deferred'].includes(decision)) {
    throw new TypeError('待確認處理方式無效');
  }

  if (getBatch(state, batchId)) {
    return state;
  }

  const pending = state.pendingItems.find((item) => item.pendingId === pendingId);

  if (!pending) {
    throw new Error(`找不到待確認項目 ${pendingId}`);
  }

  const proposal = editedProposal ? { ...pending.proposal, ...editedProposal } : pending.proposal;
  validateEditedProposal(proposal);
  let next = clone(state);
  const historyEntry = {
    schemaVersion: 1,
    batchId,
    decision,
    at: requireTimestamp(timestamp),
    proposal: clone(proposal),
  };

  next.pendingItems = next.pendingItems.map((item) =>
    item.pendingId === pendingId
      ? {
          ...item,
          proposal: clone(proposal),
          status: decision,
          decisionHistory: [...item.decisionHistory, historyEntry],
          updatedAt: timestamp,
        }
      : item,
  );
  const resolution = resolutionBatch(batchId, pending, decision, timestamp);

  if (['accepted', 'edited'].includes(decision)) {
    const event = sourceEvent(
      { ...resolution, batchId: resolution.batchId },
      proposal,
      createId('event'),
      timestamp,
      'pending_resolution',
    );
    const duplicate = next.events.some(
      (item) => item.deletedAt === null && item.dedupeKey === event.dedupeKey,
    );

    if (!duplicate) {
      resolution.committedEventIds = [event.eventId];
      resolution.acceptedProposalIds = [proposal.proposalId];
      next.events.push(event);
      next.testState.records.push(
        testRecordForEvent(event, createId('record'), timestamp),
      );
      next.testState.updatedAt = timestamp;
    }
  }

  next.batches.push(resolution);
  next.committedBatchIds.push(batchId);
  return stateWithTimestamp(
    {
      ...next,
      ...rebuildChatStateSnapshot(next),
    },
    timestamp,
  );
}

export function undoLatestCommittedBatch(
  state,
  {
    batchId = defaultId('batch'),
    timestamp = new Date().toISOString(),
    targetBatchId = null,
  } = {},
) {
  if (getBatch(state, batchId)) {
    return state;
  }

  const original = targetBatchId
    ? getBatch(state, targetBatchId)
    : [...state.batches].reverse().find(
      (batch) =>
        state.committedBatchIds.includes(batch.batchId) &&
        batch.revertedByBatchId === null &&
        (batch.committedEventIds.length > 0 || batch.pendingItemIds.length > 0),
    );

  if (!original) {
    throw new Error('沒有可撤銷的已提交批次');
  }

  const eventIds = new Set(original.committedEventIds);
  const next = clone(state);
  next.events = next.events.map((event) =>
    eventIds.has(event.eventId) && event.deletedAt === null
      ? { ...event, deletedAt: timestamp, updatedAt: timestamp }
      : event,
  );
  next.testState.records = next.testState.records.map((record) =>
    eventIds.has(record.eventId) && record.deletedAt === null
      ? { ...record, deletedAt: timestamp, updatedAt: timestamp }
      : record,
  );
  const removedHandoffIds = new Set();
  next.handoffItems = next.handoffItems.map((item) => {
    if (item.batchId === original.batchId && item.deletedAt === null) {
      removedHandoffIds.add(item.handoffId);
      return {
        ...item,
        active: false,
        deletedAt: timestamp,
        updatedAt: timestamp,
      };
    }

    return item;
  });
  next.handoffItems = next.handoffItems.map((item) =>
    item.replacedBy && removedHandoffIds.has(item.replacedBy)
      ? {
          ...item,
          active: true,
          replacedBy: null,
          updatedAt: timestamp,
        }
      : item,
  );
  const pendingIds = new Set(original.pendingItemIds ?? []);
  next.pendingItems = next.pendingItems.map((item) =>
    (pendingIds.has(item.pendingId) || item.batchId === original.batchId) && item.deletedAt === null
      ? { ...item, status: 'discarded', deletedAt: timestamp, updatedAt: timestamp }
      : item,
  );
  next.batches = next.batches.map((batch) =>
    batch.batchId === original.batchId
      ? {
          ...batch,
          revertedByBatchId: batchId,
          updatedAt: timestamp,
        }
      : batch,
  );
  next.batches.push({
    ...resolutionBatch(
      batchId,
      {
        pendingId: '',
        proposal: { proposalId: '' },
        evidence: [],
      },
      'undo',
      timestamp,
    ),
    source: 'undo',
    outcome: 'reverted',
    revertedBatchId: original.batchId,
    committedEventIds: [],
    pendingItemIds: [],
  });
  next.committedBatchIds.push(batchId);
  next.testState.updatedAt = timestamp;
  Object.assign(next, rebuildChatStateSnapshot(next));
  next.handoffItems = canonicalHandoffItems(next, batchId, timestamp);
  return stateWithTimestamp(next, timestamp);
}

// A history import is disposable as a unit. It never mutates other batches.
export function discardHistoryImportBatch(state, historyBatchId, options = {}) {
  const batch = requireBatch(state, historyBatchId);
  if (batch.source !== 'history_import') throw new Error('只可丟棄歷史匯入批次');
  return undoLatestCommittedBatch(state, { ...options, batchId: options.batchId ?? defaultId('discard_history'), targetBatchId: historyBatchId });
}

export function getResumableBatch(state) {
  return (
    [...state.batches]
      .reverse()
      .find(
        (batch) =>
          !['complete'].includes(batch.status) && batch.deletedAt === null,
      ) ?? null
  );
}
