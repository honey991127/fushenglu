import {
  STORY_ANALYSIS_JSON_SCHEMA,
  VALIDATION_RESULT_JSON_SCHEMA,
  parseAndValidateAnalysis,
  parseJsonObject,
  validateValidationResult,
} from './analysis-schema.js';

export const API_SETTINGS_SCHEMA_VERSION = 1;
export const API_SETTINGS_STORAGE_KEY = 'fushenglu.apiSettings.v1';

export const DEFAULT_API_SETTINGS = Object.freeze({
  schemaVersion: API_SETTINGS_SCHEMA_VERSION,
  baseUrl: '',
  apiKey: '',
  analysisModel: '',
  generationModel: '',
  validationModel: '',
  temperature: 0.2,
  maxOutputTokens: 2048,
});

export class ApiSettingsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ApiSettingsError';
  }
}

export class ApiRequestError extends Error {
  constructor(message, { status = null, responseCode = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ApiRequestError';
    this.status = status;
    this.responseCode = responseCode;
  }
}

function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeApiSettings(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ApiSettingsError('API 設定格式無效');
  }

  const sourceVersion = raw.schemaVersion ?? API_SETTINGS_SCHEMA_VERSION;

  if (sourceVersion !== API_SETTINGS_SCHEMA_VERSION) {
    throw new ApiSettingsError(`不支援 API 設定版本 ${sourceVersion}`);
  }

  const temperature = Number(raw.temperature ?? DEFAULT_API_SETTINGS.temperature);
  const rawValue =
    raw.maxOutputTokens ?? DEFAULT_API_SETTINGS.maxOutputTokens;
  const value = Number.parseInt(String(rawValue).trim(), 10);
  const hasIntegerSyntax = /^[+-]?\d+$/.test(String(rawValue).trim());

  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    throw new ApiSettingsError('Temperature 必須介於 0 與 2');
  }

  if (
    !Number.isInteger(value) ||
    !hasIntegerSyntax ||
    value < 1 ||
    value > 131072
  ) {
    throw new ApiSettingsError('最大輸出 Tokens 必須是 1 至 131072 的整數');
  }

  const baseUrl = normalizeString(raw.baseUrl);

  if (baseUrl) {
    let parsed;

    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new ApiSettingsError('API Base URL 格式無效');
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new ApiSettingsError('API Base URL 只支援 HTTP 或 HTTPS');
    }
  }

  return {
    schemaVersion: API_SETTINGS_SCHEMA_VERSION,
    baseUrl,
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '',
    analysisModel: normalizeString(raw.analysisModel),
    generationModel: normalizeString(raw.generationModel),
    validationModel: normalizeString(raw.validationModel),
    temperature,
    maxOutputTokens: value,
  };
}

export function maskApiKey(apiKey) {
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    return '';
  }

  const visible = apiKey.slice(-4);
  return `${'•'.repeat(Math.max(8, apiKey.length - visible.length))}${visible}`;
}

export function exportApiSettings(settings) {
  const normalized = normalizeApiSettings(settings);
  const { apiKey: _omitted, ...safeSettings } = normalized;
  return safeSettings;
}

export function redactSensitive(value, secrets = []) {
  const secretValues = secrets.filter(
    (secret) => typeof secret === 'string' && secret.length > 0,
  );

  if (typeof value === 'string') {
    return secretValues.reduce(
      (text, secret) => text.split(secret).join('[REDACTED]'),
      value,
    );
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, secretValues));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /api.?key|authorization|token/i.test(key)
          ? '[REDACTED]'
          : redactSensitive(item, secretValues),
      ]),
    );
  }

  return value;
}

export function createSafeLogger(logger = console, getSecrets = () => []) {
  return Object.freeze({
    info(message, detail) {
      logger?.info?.(
        redactSensitive(message, getSecrets()),
        redactSensitive(detail, getSecrets()),
      );
    },
    warn(message, detail) {
      logger?.warn?.(
        redactSensitive(message, getSecrets()),
        redactSensitive(detail, getSecrets()),
      );
    },
    error(message, detail) {
      logger?.error?.(
        redactSensitive(message, getSecrets()),
        redactSensitive(detail, getSecrets()),
      );
    },
  });
}

function createMemoryStorage() {
  const values = new Map();

  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

export class BrowserApiSettingsStore {
  constructor({
    storage = null,
    storageKey = API_SETTINGS_STORAGE_KEY,
  } = {}) {
    this.storage = storage ?? createMemoryStorage();
    this.storageKey = storageKey;
  }

  load() {
    const raw = this.storage.getItem(this.storageKey);

    if (!raw) {
      return clone(DEFAULT_API_SETTINGS);
    }

    try {
      return normalizeApiSettings(JSON.parse(raw));
    } catch (error) {
      throw new ApiSettingsError(
        `無法讀取插件 API 設定：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  save(settings) {
    const normalized = normalizeApiSettings(settings);
    this.storage.setItem(this.storageKey, JSON.stringify(normalized));
    return clone(normalized);
  }

  clearApiKey() {
    const settings = this.load();
    settings.apiKey = '';
    return this.save(settings);
  }

  export() {
    return exportApiSettings(this.load());
  }
}

export function createChatCompletionsUrl(baseUrl) {
  const normalized = normalizeString(baseUrl).replace(/\/+$/, '');

  if (!normalized) {
    throw new ApiSettingsError('請先設定 API Base URL');
  }

  if (/\/chat\/completions$/i.test(normalized)) {
    return normalized;
  }

  return `${normalized}/chat/completions`;
}

export function createModelsUrl(baseUrl) {
  const normalized = normalizeString(baseUrl).replace(/\/+$/, '');

  if (!normalized) {
    throw new ApiSettingsError('請先設定 API Base URL');
  }

  let parsed;

  try {
    parsed = new URL(normalized);
  } catch {
    throw new ApiSettingsError('API Base URL 格式無效');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ApiSettingsError('API Base URL 只支援 HTTP 或 HTTPS');
  }

  return `${normalized}/models`;
}

export function parseModelList(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.data)) {
    throw new ApiRequestError('模型清單格式無效');
  }

  return [
    ...new Set(
      payload.data
        .map((item) => normalizeString(item?.id))
        .filter(Boolean),
    ),
  ].sort();
}

function modelForSlot(settings, slot) {
  const fields = {
    analysis: 'analysisModel',
    generation: 'generationModel',
    validation: 'validationModel',
  };
  const field = fields[slot];

  if (!field) {
    throw new ApiSettingsError(`未知模型槽位：${slot}`);
  }

  const model = settings[field];

  if (!model) {
    throw new ApiSettingsError(`請先設定${slot === 'analysis' ? '劇情分析' : slot === 'generation' ? '生成／問答' : '校驗'}模型`);
  }

  return model;
}

function extractContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => (typeof part === 'string' ? part : part?.text ?? ''))
      .join('');

    if (text) {
      return text;
    }
  }

  throw new ApiRequestError('API 回應缺少 choices[0].message.content');
}

function structuredOutputUnsupported(error) {
  if (!(error instanceof ApiRequestError) || ![400, 404, 422].includes(error.status)) {
    return false;
  }

  return /response.?format|json.?schema|structured|unknown parameter|unsupported/i.test(
    error.message,
  );
}

function safeErrorSummary(payload, status) {
  const message =
    typeof payload?.error?.message === 'string'
      ? payload.error.message
      : typeof payload?.message === 'string'
        ? payload.message
        : `HTTP ${status}`;
  const code =
    typeof payload?.error?.code === 'string' ? payload.error.code : null;
  return { message, code };
}

const ANALYSIS_SYSTEM_PROMPT = `
你是浮生錄插件的劇情分析器。你只輸出符合指定 JSON Schema 的候選變化，不得直接修改資料。
只分析輸入中的 user／assistant 新訊息。回憶、引用、傳聞、假設和夢境中的時間不可當作主時間線；
story_time 必須填 timelineContext。明確小型變化可標 minor；衝突、突破、新技能、新人物、
新地點或所有權含糊者必須標 major/critical 並放 uncertainItems。每項證據必須引用輸入的 messageRef。
dedupeKey 必須可重現且代表同一事實。沒有變化時回傳所有空陣列。不得輸出 Markdown。
`.trim();

const CORRECTION_SYSTEM_PROMPT = `
你是浮生錄插件的自然語言修正解析器。你只能把玩家文字轉成候選修改，輸出完整劇情分析 JSON Schema；
不得直接改資料。把確定的修正放在對應 changes 陣列，不確定修正放 uncertainItems。
evidenceMessageRef 使用 correction:<batchId>，reason 簡短說明解析方式。不得虛構未提供內容或輸出 Markdown。
`.trim();

export class OpenAICompatibleClient {
  constructor({
    settingsStore,
    fetchImpl = globalThis.fetch?.bind(globalThis),
    logger = console,
  } = {}) {
    if (!settingsStore) {
      throw new TypeError('OpenAICompatibleClient 需要 settingsStore');
    }

    if (typeof fetchImpl !== 'function') {
      throw new TypeError('目前環境沒有 fetch');
    }

    this.settingsStore = settingsStore;
    this.fetchImpl = fetchImpl;
    this.logger = createSafeLogger(logger, () => {
      try {
        return [this.settingsStore.load().apiKey];
      } catch {
        return [];
      }
    });
  }

  async request(slot, messages, {
    jsonSchema = null,
    maxOutputTokens = null,
    temperature = null,
  } = {}) {
    const settings = this.settingsStore.load();
    const model = modelForSlot(settings, slot);
    const url = createChatCompletionsUrl(settings.baseUrl);
    const performRequest = async (includeStructuredOutput) => {
      const body = {
        model,
        messages,
        temperature: temperature ?? settings.temperature,
        max_tokens: maxOutputTokens ?? settings.maxOutputTokens,
      };

      if (includeStructuredOutput && jsonSchema) {
        body.response_format = {
          type: 'json_schema',
          json_schema: jsonSchema,
        };
      }

      let response;

      try {
        response = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(settings.apiKey
              ? { Authorization: `Bearer ${settings.apiKey}` }
              : {}),
          },
          body: JSON.stringify(body),
        });
      } catch (error) {
        this.logger.error('插件 API 網路請求失敗', {
          url,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new ApiRequestError('無法連線至插件 API', { cause: error });
      }

      let payload;

      try {
        payload = await response.json();
      } catch (error) {
        throw new ApiRequestError(`API 回應不是 JSON（HTTP ${response.status}）`, {
          status: response.status,
          cause: error,
        });
      }

      if (!response.ok) {
        const summary = safeErrorSummary(payload, response.status);
        throw new ApiRequestError(`API 請求失敗：${summary.message}`, {
          status: response.status,
          responseCode: summary.code,
        });
      }

      return extractContent(payload);
    };

    if (!jsonSchema) {
      return performRequest(false);
    }

    try {
      return await performRequest(true);
    } catch (error) {
      if (!structuredOutputUnsupported(error)) {
        throw error;
      }

      this.logger.warn('模型不支援 structured output，改用 JSON 解析與本地 Schema 驗證', {
        status: error.status,
      });
      return performRequest(false);
    }
  }

  async testConnection() {
    const settings = this.settingsStore.load();
    const slot = 'analysis';
    const content = await this.request(
      slot,
      [
        {
          role: 'user',
          content: '只回覆 OK',
        },
      ],
      {
        maxOutputTokens: 16,
        temperature: 0,
      },
    );

    return {
      ok: true,
      model: modelForSlot(settings, slot),
      response: content.slice(0, 80),
    };
  }

  async loadModels(connection = null) {
    const storedSettings = this.settingsStore.load();
    const baseUrl =
      connection && Object.hasOwn(connection, 'baseUrl')
        ? connection.baseUrl
        : storedSettings.baseUrl;
    const apiKey =
      connection && Object.hasOwn(connection, 'apiKey')
        ? String(connection.apiKey ?? '').trim()
        : storedSettings.apiKey;
    const url = createModelsUrl(baseUrl);
    let response;

    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
      });
    } catch (error) {
      this.logger.error('載入模型時無法連線至 API', {
        url,
        error: redactSensitive(
          error instanceof Error ? error.message : String(error),
          [apiKey],
        ),
      });
      throw new ApiRequestError('無法連線以載入模型', { cause: error });
    }

    let payload;

    try {
      payload = await response.json();
    } catch (error) {
      if (!response.ok) {
        throw new ApiRequestError(`載入模型失敗（HTTP ${response.status}）`, {
          status: response.status,
          cause: error,
        });
      }

      throw new ApiRequestError('模型清單不是合法 JSON', {
        status: response.status,
        cause: error,
      });
    }

    if (!response.ok) {
      const summary = safeErrorSummary(payload, response.status);
      const safeMessage = redactSensitive(summary.message, [apiKey]);
      throw new ApiRequestError(
        `載入模型失敗（HTTP ${response.status}）：${safeMessage}`,
        {
          status: response.status,
          responseCode: summary.code,
        },
      );
    }

    return parseModelList(payload);
  }

  async analyzeMessages(messages, { batchId } = {}) {
    const content = await this.request(
      'analysis',
      [
        { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            schemaVersion: 1,
            batchId,
            messages,
          }),
        },
      ],
      { jsonSchema: STORY_ANALYSIS_JSON_SCHEMA },
    );
    const result = parseAndValidateAnalysis(content);
    const settings = this.settingsStore.load();

    if (settings.validationModel) {
      const validationContent = await this.request(
        'validation',
        [
          {
            role: 'system',
            content:
              '校驗候選分析是否忠於輸入證據且無直接套用指令。只輸出指定 JSON。',
          },
          {
            role: 'user',
            content: JSON.stringify({ messages, result }),
          },
        ],
        {
          jsonSchema: VALIDATION_RESULT_JSON_SCHEMA,
          temperature: 0,
        },
      );
      const validation = validateValidationResult(
        parseJsonObject(validationContent),
      );

      if (!validation.valid) {
        throw new ApiRequestError(
          `校驗模型拒絕分析：${validation.issues.join('；') || '未提供原因'}`,
        );
      }
    }

    return result;
  }

  async parseCorrection(text, { batchId } = {}) {
    const content = await this.request(
      'generation',
      [
        { role: 'system', content: CORRECTION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            schemaVersion: 1,
            batchId,
            correction: text,
          }),
        },
      ],
      {
        jsonSchema: STORY_ANALYSIS_JSON_SCHEMA,
        temperature: 0,
      },
    );

    return parseAndValidateAnalysis(content);
  }
}
