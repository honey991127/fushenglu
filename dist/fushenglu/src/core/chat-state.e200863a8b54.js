import {
  CHARACTER_STATE_SCHEMA_VERSION,
  createCharacterState,
  rebuildCharacterState,
} from './character-state.248f6757f446.js';
import { rebuildCurrentSnapshot } from './snapshot-reducer.89fe66760214.js';

export const CHAT_STATE_SCHEMA_VERSION = 5;

const BATCH_STATUSES = new Set([
  'draft',
  'analysis_pending',
  'review_ready',
  'committing',
  'committed',
  'handoff_pending',
  'complete',
  'failed',
]);

export class ChatStateMigrationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ChatStateMigrationError';
  }
}

function requireTimestamp(timestamp) {
  if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) {
    throw new TypeError('timestamp 必須是有效的 ISO 日期字串');
  }

  return timestamp;
}

function requireOptionalTimestamp(value, field) {
  if (
    value !== null &&
    (typeof value !== 'string' || Number.isNaN(Date.parse(value)))
  ) {
    throw new ChatStateMigrationError(`${field} 必須是有效的 ISO 日期字串或 null`);
  }

  return value;
}

function normalizeSampleValue(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new ChatStateMigrationError('示例值必須是字串或 null');
  }

  return value;
}

function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function createSyncState() {
  return {
    schemaVersion: 1,
    lastSuccessfulIndex: -1,
    processedSlotKeys: [],
    ignoredSlotKeys: [],
    capability: 'index_fallback',
    limitation: '尚未讀取宿主聊天訊息能力。',
    branchFingerprint: '',
  };
}

function createTestState() {
  return {
    schemaVersion: 1,
    records: [],
    updatedAt: null,
  };
}

function createLegacyState() {
  return {
    schemaVersion: 1,
    sampleValue: null,
    importedAt: null,
  };
}

function createHistoryImportProgress() {
  return {
    schemaVersion: 1,
    pipelineVersion: 2,
    branchFingerprint: '',
    messageRefsHash: '',
    chunkBoundaries: [],
    completedChunkIndexes: [],
    failedChunkIndex: null,
    rollingContext: null,
    updatedAt: null,
  };
}

function createWorldRules() {
  return { schemaVersion: 1, entries: [] };
}

function createPendingDecisionRecords() {
  return [];
}

function relationshipEntries(character) {
  return Object.values(character.entities.byId).flatMap((entity) =>
    Object.entries(entity.relationships ?? {}).map(([targetEntityId, value]) => ({
      schemaVersion: 1,
      sourceEntityId: entity.entityId,
      targetEntityId,
      ...clone(value),
    })),
  );
}

function createEventLedger(events, updatedAt = null) {
  const visibleEvents = events.filter((event) => event && typeof event.eventId === 'string');
  return {
    schemaVersion: 1,
    eventIds: visibleEvents.map((event) => event.eventId),
    deletedEventIds: visibleEvents.filter((event) => event.deletedAt !== null).map((event) => event.eventId),
    rebuiltAt: updatedAt,
  };
}

function createDerivedState(events, updatedAt = null) {
  const character = rebuildCharacterState(events);
  const snapshot = rebuildCurrentSnapshot(events, updatedAt);
  return {
    character,
    currentSnapshot: { ...snapshot, character: clone(character) },
    entities: clone(character.entities),
    relationships: {
      schemaVersion: 1,
      entries: relationshipEntries(character),
    },
    eventLedger: createEventLedger(events, updatedAt),
  };
}

function createEmptyDerivedState() {
  return createDerivedState([], null);
}

export function createChatState(timestamp = new Date().toISOString()) {
  requireTimestamp(timestamp);

  return {
    schemaVersion: CHAT_STATE_SCHEMA_VERSION,
    updatedAt: null,
    draftActions: [],
    sync: createSyncState(),
    batches: [],
    events: [],
    pendingItems: [],
    handoffItems: [],
    committedBatchIds: [],
    character: createCharacterState(),
    ...createEmptyDerivedState(),
    worldRules: createWorldRules(),
    historyImportProgress: createHistoryImportProgress(),
    pendingDecisionRecords: createPendingDecisionRecords(),
    testState: createTestState(),
    legacy: createLegacyState(),
  };
}

function requireArray(value, field) {
  if (!Array.isArray(value)) {
    throw new ChatStateMigrationError(`${field} 必須是陣列`);
  }

  return clone(value);
}

function requireVersionedEntities(
  items,
  field,
  supportedVersions = [1],
) {
  for (const [index, item] of items.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new ChatStateMigrationError(`${field}[${index}] 必須是物件`);
    }

    if (!supportedVersions.includes(item.schemaVersion)) {
      throw new ChatStateMigrationError(`${field}[${index}] 版本無效`);
    }
  }

  return items;
}

function normalizeEvents(items) {
  return items.map((rawItem, index) => {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
      throw new ChatStateMigrationError(`events[${index}] 必須是物件`);
    }

    const item = clone(rawItem);
    const rawVersion = item.schemaVersion;
    const parsedVersion =
      typeof rawVersion === 'string' && /^[12]$/.test(rawVersion)
        ? Number(rawVersion)
        : rawVersion;
    const recognizableLegacyEvent =
      typeof item.eventId === 'string' &&
      item.eventId.trim() !== '' &&
      typeof item.kind === 'string' &&
      item.kind.trim() !== '' &&
      typeof item.operation === 'string' &&
      item.operation.trim() !== '' &&
      Object.hasOwn(item, 'value');
    const missingLegacyVersion =
      rawVersion === undefined ||
      rawVersion === null ||
      rawVersion === 0 ||
      rawVersion === '0';
    const schemaVersion =
      missingLegacyVersion && recognizableLegacyEvent
        ? 1
        : parsedVersion;

    if (![1, 2].includes(schemaVersion)) {
      throw new ChatStateMigrationError(
        `events[${index}] 版本無效（收到 ${String(rawVersion)}；支援 1、2）`,
      );
    }

    return {
      ...item,
      schemaVersion,
      sourceMessageRefs: Array.isArray(item.sourceMessageRefs)
        ? [...item.sourceMessageRefs]
        : [],
      deletedAt:
        item.deletedAt === undefined ? null : item.deletedAt,
      updatedAt:
        item.updatedAt ?? item.createdAt ?? null,
    };
  });
}





function normalizeSyncState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ChatStateMigrationError('sync 格式無效');
  }

  if (raw.schemaVersion !== 1) {
    throw new ChatStateMigrationError('sync.schemaVersion 必須是 1');
  }

  if (!Number.isInteger(raw.lastSuccessfulIndex) || raw.lastSuccessfulIndex < -1) {
    throw new ChatStateMigrationError('sync.lastSuccessfulIndex 格式無效');
  }

  const capabilities = [
    'stable_message_id',
    'reproducible_fingerprint',
    'index_fallback',
  ];

  if (!capabilities.includes(raw.capability)) {
    throw new ChatStateMigrationError('sync.capability 格式無效');
  }

  if (raw.limitation !== null && typeof raw.limitation !== 'string') {
    throw new ChatStateMigrationError('sync.limitation 格式無效');
  }

  return {
    schemaVersion: 1,
    lastSuccessfulIndex: raw.lastSuccessfulIndex,
    processedSlotKeys: requireArray(
      raw.processedSlotKeys,
      'sync.processedSlotKeys',
    ).map(String),
    ignoredSlotKeys: requireArray(
      raw.ignoredSlotKeys,
      'sync.ignoredSlotKeys',
    ).map(String),
    capability: raw.capability,
    limitation: raw.limitation,
    branchFingerprint:
      typeof raw.branchFingerprint === 'string' ? raw.branchFingerprint : '',
  };
}

function normalizeTestState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ChatStateMigrationError('testState 格式無效');
  }

  if (raw.schemaVersion !== 1) {
    throw new ChatStateMigrationError('testState.schemaVersion 必須是 1');
  }

  const records = requireVersionedEntities(
    requireArray(raw.records, 'testState.records'),
    'testState.records',
  );

  return {
    schemaVersion: 1,
    records,
    updatedAt: requireOptionalTimestamp(raw.updatedAt ?? null, 'testState.updatedAt'),
  };
}

function normalizeLegacyState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return createLegacyState();
  }

  if (raw.schemaVersion !== 1) {
    throw new ChatStateMigrationError('legacy.schemaVersion 必須是 1');
  }

  return {
    schemaVersion: 1,
    sampleValue: normalizeSampleValue(raw.sampleValue),
    importedAt: requireOptionalTimestamp(raw.importedAt ?? null, 'legacy.importedAt'),
  };
}

function normalizeV2(rawState) {
  const batches = requireVersionedEntities(
    requireArray(rawState.batches, 'batches'),
    'batches',
  );

  for (const [index, batch] of batches.entries()) {
    if (!BATCH_STATUSES.has(batch.status)) {
      throw new ChatStateMigrationError(`batches[${index}].status 不合法`);
    }

    if (typeof batch.batchId !== 'string' || batch.batchId === '') {
      throw new ChatStateMigrationError(`batches[${index}].batchId 無效`);
    }
  }

  const committedBatchIds = requireArray(
    rawState.committedBatchIds,
    'committedBatchIds',
  ).map(String);

  if (new Set(committedBatchIds).size !== committedBatchIds.length) {
    throw new ChatStateMigrationError('committedBatchIds 不得重複');
  }

  return {
    schemaVersion: 2,
    updatedAt: requireOptionalTimestamp(rawState.updatedAt ?? null, 'updatedAt'),
    draftActions: requireVersionedEntities(
      requireArray(rawState.draftActions, 'draftActions'),
      'draftActions',
    ),
    sync: normalizeSyncState(rawState.sync),
    batches,
    events: normalizeEvents(
      requireArray(rawState.events, 'events'),
    ),
    pendingItems: requireVersionedEntities(
      requireArray(rawState.pendingItems, 'pendingItems'),
      'pendingItems',
    ),
    handoffItems: requireVersionedEntities(
      requireArray(rawState.handoffItems, 'handoffItems'),
      'handoffItems',
    ),
    committedBatchIds,
    testState: normalizeTestState(rawState.testState),
    legacy: normalizeLegacyState(rawState.legacy),
  };
}

function normalizeV4(rawState) {
  const normalized = normalizeV2({ ...rawState, schemaVersion: 2 });
  const rawCharacter = rawState.character;
  if (
    rawCharacter !== undefined &&
    (!rawCharacter || ![1, CHARACTER_STATE_SCHEMA_VERSION].includes(rawCharacter.schemaVersion))
  ) {
    throw new ChatStateMigrationError('character.schemaVersion invalid');
  }
  const progress = rawState.historyImportProgress ?? createHistoryImportProgress();
  if (
    !progress ||
    progress.schemaVersion !== 1 ||
    !Number.isInteger(progress.pipelineVersion) ||
    typeof progress.branchFingerprint !== 'string' ||
    typeof progress.messageRefsHash !== 'string' ||
    !Array.isArray(progress.chunkBoundaries) ||
    !Array.isArray(progress.completedChunkIndexes) ||
    !(progress.failedChunkIndex === null || Number.isInteger(progress.failedChunkIndex)) ||
    !(progress.rollingContext === null || (typeof progress.rollingContext === 'object' && !Array.isArray(progress.rollingContext))) ||
    !(progress.updatedAt === null || (typeof progress.updatedAt === 'string' && !Number.isNaN(Date.parse(progress.updatedAt))))
  ) {
    throw new ChatStateMigrationError('historyImportProgress format invalid');
  }
  return {
    ...normalized,
    schemaVersion: 4,
    ...createDerivedState(normalized.events, normalized.updatedAt),
    historyImportProgress: {
      ...createHistoryImportProgress(),
      ...clone(progress),
      pipelineVersion: 2,
    },
  };
}

function normalizeRootObject(raw, field) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ChatStateMigrationError(field + ' format invalid');
  }
  return raw;
}

function normalizeWorldRules(raw) {
  const value = normalizeRootObject(raw, 'worldRules');
  if (value.schemaVersion !== 1) throw new ChatStateMigrationError('worldRules.schemaVersion invalid');
  return { schemaVersion: 1, entries: requireVersionedEntities(requireArray(value.entries, 'worldRules.entries'), 'worldRules.entries') };
}

function normalizeEntities(raw) {
  const value = normalizeRootObject(raw, 'entities');
  if (value.schemaVersion !== 1 || !value.byId || typeof value.byId !== 'object' || Array.isArray(value.byId) || typeof value.playerEntityId !== 'string') {
    throw new ChatStateMigrationError('entities format invalid');
  }
  for (const [entityId, entity] of Object.entries(value.byId)) {
    if (!entity || entity.schemaVersion !== 1 || entity.entityId !== entityId) {
      throw new ChatStateMigrationError('entities.byId format invalid');
    }
  }
  return clone(value);
}

function normalizeRelationships(raw) {
  const value = normalizeRootObject(raw, 'relationships');
  if (value.schemaVersion !== 1) throw new ChatStateMigrationError('relationships.schemaVersion invalid');
  return { schemaVersion: 1, entries: requireVersionedEntities(requireArray(value.entries, 'relationships.entries'), 'relationships.entries') };
}

function normalizeSnapshot(raw, events) {
  const value = normalizeRootObject(raw, 'currentSnapshot');
  if (![1, 2].includes(value.schemaVersion) || !Array.isArray(value.sourceEventIds)) {
    throw new ChatStateMigrationError('currentSnapshot format invalid');
  }
  return createDerivedState(events, value.rebuiltAt ?? null).currentSnapshot;
}

function normalizeEventLedger(raw) {
  const value = normalizeRootObject(raw, 'eventLedger');
  if (value.schemaVersion !== 1 || !Array.isArray(value.eventIds) || !Array.isArray(value.deletedEventIds)) {
    throw new ChatStateMigrationError('eventLedger format invalid');
  }
  return {
    schemaVersion: 1,
    eventIds: value.eventIds.map(String),
    deletedEventIds: value.deletedEventIds.map(String),
    rebuiltAt: requireOptionalTimestamp(value.rebuiltAt ?? null, 'eventLedger.rebuiltAt'),
  };
}

function normalizeV5(rawState) {
  const v4 = normalizeV4({ ...rawState, schemaVersion: 4 });
  return {
    ...v4,
    schemaVersion: 5,
    worldRules: normalizeWorldRules(rawState.worldRules),
    entities: normalizeEntities(rawState.entities),
    relationships: normalizeRelationships(rawState.relationships),
    currentSnapshot: normalizeSnapshot(rawState.currentSnapshot, v4.events),
    eventLedger: normalizeEventLedger(rawState.eventLedger),
    pendingDecisionRecords: requireVersionedEntities(
      requireArray(rawState.pendingDecisionRecords, 'pendingDecisionRecords'),
      'pendingDecisionRecords',
    ),
  };
}

function migrateV4ToV5(rawState) {
  const v4 = normalizeV4({ ...rawState, schemaVersion: 4 });
  return {
    ...v4,
    schemaVersion: CHAT_STATE_SCHEMA_VERSION,
    ...createDerivedState(v4.events, v4.updatedAt),
    worldRules: createWorldRules(),
    pendingDecisionRecords: createPendingDecisionRecords(),
  };
}

function migrateLegacyState(rawState, sourceVersion, timestamp) {
  const legacySampleValue =
    sourceVersion === 1
      ? rawState.sampleValue ?? rawState.legacy?.sampleValue ?? null
      : rawState.sampleValue ?? rawState.exampleValue ?? rawState.sample ?? null;
  const state = createChatState(timestamp);
  state.updatedAt = timestamp;
  state.legacy = {
    schemaVersion: 1,
    sampleValue: normalizeSampleValue(legacySampleValue),
    importedAt: timestamp,
  };
  return state;
}

export function migrateChatState(rawState, timestamp = new Date().toISOString()) {
  requireTimestamp(timestamp);
  if (rawState === undefined || rawState === null) {
    return { state: createChatState(timestamp), created: true, migrated: false, fromVersion: null };
  }
  if (typeof rawState !== 'object' || Array.isArray(rawState)) {
    throw new ChatStateMigrationError('chat state format invalid; overwrite stopped');
  }
  const sourceVersion = rawState.schemaVersion ?? 0;
  if (!Number.isInteger(sourceVersion) || sourceVersion < 0) {
    throw new ChatStateMigrationError('schemaVersion must be a non-negative integer');
  }
  if (sourceVersion > CHAT_STATE_SCHEMA_VERSION) {
    throw new ChatStateMigrationError('future schemaVersion; overwrite stopped');
  }
  if (sourceVersion < 2) {
    return { state: migrateLegacyState(rawState, sourceVersion, timestamp), created: false, migrated: true, fromVersion: sourceVersion };
  }
  if (sourceVersion < CHAT_STATE_SCHEMA_VERSION) {
    return { state: migrateV4ToV5(rawState), created: false, migrated: true, fromVersion: sourceVersion };
  }
  return { state: normalizeV5(rawState), created: false, migrated: false, fromVersion: CHAT_STATE_SCHEMA_VERSION };
}

export function rebuildChatStateSnapshot(state, timestamp = null) {
  const normalized = validateChatState(state);
  return {
    ...normalized,
    ...createDerivedState(normalized.events, timestamp ?? normalized.updatedAt),
  };
}

export function resetCurrentChatData(state, {
  preserveWorldRules = true,
  timestamp = new Date().toISOString(),
} = {}) {
  const normalized = validateChatState(state, timestamp);
  const empty = createChatState(timestamp);
  return {
    ...normalized,
    updatedAt: requireTimestamp(timestamp),
    draftActions: [],
    sync: createSyncState(),
    batches: [],
    events: [],
    pendingItems: [],
    handoffItems: [],
    committedBatchIds: [],
    testState: createTestState(),
    historyImportProgress: createHistoryImportProgress(),
    pendingDecisionRecords: createPendingDecisionRecords(),
    ...createEmptyDerivedState(),
    worldRules: preserveWorldRules ? clone(normalized.worldRules) : createWorldRules(),
  };
}

export function validateChatState(state, timestamp = new Date().toISOString()) {
  return migrateChatState(state, timestamp).state;
}

export function setSampleValue(state, value, timestamp = new Date().toISOString()) {
  const normalized = validateChatState(state, timestamp);

  return {
    ...normalized,
    updatedAt: requireTimestamp(timestamp),
    legacy: {
      ...normalized.legacy,
      sampleValue: normalizeSampleValue(value),
      importedAt: normalized.legacy.importedAt ?? timestamp,
    },
  };
}

function sanitizeForExport(value, secrets) {
  if (typeof value === 'string') {
    return secrets.reduce(
      (text, secret) => text.split(secret).join('[REDACTED]'),
      value,
    );
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForExport(item, secrets));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/api.?key|authorization/i.test(key))
        .map(([key, item]) => [key, sanitizeForExport(item, secrets)]),
    );
  }

  return value;
}

export function exportChatState(state, { secrets = [] } = {}) {
  const normalized = validateChatState(state);
  return sanitizeForExport(
    normalized,
    secrets.filter((secret) => typeof secret === 'string' && secret.length > 0),
  );
}
