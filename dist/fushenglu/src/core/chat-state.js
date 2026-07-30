import {
  CHARACTER_STATE_SCHEMA_VERSION,
  createCharacterState,
  rebuildCharacterState,
} from './character-state.js';

export const CHAT_STATE_SCHEMA_VERSION = 4;

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
    updatedAt: null,
  };
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
    historyImportProgress: createHistoryImportProgress(),
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
    events: requireVersionedEntities(
      requireArray(rawState.events, 'events'),
      'events',
      [1, 2],
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

function normalizeV3(rawState) {
  const normalized = normalizeV2(rawState);

  if (!rawState.character || ![1, CHARACTER_STATE_SCHEMA_VERSION].includes(rawState.character.schemaVersion)) {
    throw new ChatStateMigrationError('character.schemaVersion 無效');
  }

  const rebuiltCharacter = rebuildCharacterState(normalized.events);

  return {
    ...normalized,
    schemaVersion: 3,
    character: rebuiltCharacter,
  };
}

function migrateV3State(rawState) {
  const normalized = normalizeV3(rawState);
  return {
    ...normalized,
    schemaVersion: CHAT_STATE_SCHEMA_VERSION,
    // V3 only stored chunk counts; it is unsafe after a branch/edit/pipeline change.
    historyImportProgress: createHistoryImportProgress(),
    character: rebuildCharacterState(normalized.events),
  };
}

function normalizeV4(rawState) {
  const migrated = migrateV3State({ ...rawState, schemaVersion: 3 });
  const progress = rawState.historyImportProgress ?? createHistoryImportProgress();
  if (!progress || progress.schemaVersion !== 1 || !Array.isArray(progress.chunkBoundaries) || !Array.isArray(progress.completedChunkIndexes)) {
    throw new ChatStateMigrationError('historyImportProgress 格式無效');
  }
  return {
    ...migrated,
    historyImportProgress: {
      ...createHistoryImportProgress(),
      ...clone(progress),
      pipelineVersion: 2,
    },
  };
}

function migrateV2State(rawState) {
  const normalized = normalizeV2(rawState);

  return {
    ...normalized,
    schemaVersion: CHAT_STATE_SCHEMA_VERSION,
    character: rebuildCharacterState(normalized.events),
    historyImportProgress: createHistoryImportProgress(),
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
    return {
      state: createChatState(timestamp),
      created: true,
      migrated: false,
      fromVersion: null,
    };
  }

  if (typeof rawState !== 'object' || Array.isArray(rawState)) {
    throw new ChatStateMigrationError('聊天儲存資料格式無效，已停止覆寫');
  }

  const sourceVersion = rawState.schemaVersion ?? 0;

  if (!Number.isInteger(sourceVersion) || sourceVersion < 0) {
    throw new ChatStateMigrationError('schemaVersion 必須是非負整數');
  }

  if (sourceVersion > CHAT_STATE_SCHEMA_VERSION) {
    throw new ChatStateMigrationError(
      `資料版本 ${sourceVersion} 高於目前支援版本 ${CHAT_STATE_SCHEMA_VERSION}，已停止覆寫`,
    );
  }

  if (sourceVersion === 2) {
    return {
      state: migrateV2State(rawState),
      created: false,
      migrated: true,
      fromVersion: sourceVersion,
    };
  }

  if (sourceVersion === 3) {
    return {
      state: migrateV3State(rawState),
      created: false,
      migrated: true,
      fromVersion: sourceVersion,
    };
  }

  if (sourceVersion < CHAT_STATE_SCHEMA_VERSION) {
    return {
      state: migrateLegacyState(rawState, sourceVersion, timestamp),
      created: false,
      migrated: true,
      fromVersion: sourceVersion,
    };
  }

  return {
    state: normalizeV4(rawState),
    created: false,
    migrated: false,
    fromVersion: CHAT_STATE_SCHEMA_VERSION,
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
