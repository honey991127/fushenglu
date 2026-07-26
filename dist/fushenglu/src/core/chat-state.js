export const CHAT_STATE_SCHEMA_VERSION = 1;

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

function normalizeSampleValue(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new ChatStateMigrationError('示例值必須是字串或 null');
  }

  return value;
}

export function createChatState(timestamp = new Date().toISOString()) {
  requireTimestamp(timestamp);

  return {
    schemaVersion: CHAT_STATE_SCHEMA_VERSION,
    sampleValue: null,
    updatedAt: null,
  };
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

  if (sourceVersion === 0) {
    const legacySampleValue =
      rawState.sampleValue ?? rawState.exampleValue ?? rawState.sample ?? null;

    return {
      state: {
        schemaVersion: CHAT_STATE_SCHEMA_VERSION,
        sampleValue: normalizeSampleValue(legacySampleValue),
        updatedAt: timestamp,
      },
      created: false,
      migrated: true,
      fromVersion: 0,
    };
  }

  const sampleValue = normalizeSampleValue(rawState.sampleValue);
  const updatedAt = rawState.updatedAt ?? null;

  if (updatedAt !== null && (typeof updatedAt !== 'string' || Number.isNaN(Date.parse(updatedAt)))) {
    throw new ChatStateMigrationError('updatedAt 必須是有效的 ISO 日期字串或 null');
  }

  const needsNormalization =
    !Object.hasOwn(rawState, 'sampleValue') || !Object.hasOwn(rawState, 'updatedAt');

  return {
    state: {
      schemaVersion: CHAT_STATE_SCHEMA_VERSION,
      sampleValue,
      updatedAt,
    },
    created: false,
    migrated: needsNormalization,
    fromVersion: CHAT_STATE_SCHEMA_VERSION,
  };
}

export function setSampleValue(state, value, timestamp = new Date().toISOString()) {
  const normalized = migrateChatState(state, timestamp).state;

  return {
    ...normalized,
    sampleValue: normalizeSampleValue(value),
    updatedAt: requireTimestamp(timestamp),
  };
}
