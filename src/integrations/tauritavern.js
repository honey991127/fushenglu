import { migrateChatState, setSampleValue } from '../core/chat-state.js';

export const CHAT_METADATA_KEY = 'fushenglu.chatState';

export class TavernCapabilityError extends Error {
  constructor(missingCapabilities) {
    super(`缺少必要的 TauriTavern／SillyTavern 公開接口：${missingCapabilities.join('、')}`);
    this.name = 'TavernCapabilityError';
    this.missingCapabilities = [...missingCapabilities];
  }
}

export class NoActiveChatError extends Error {
  constructor() {
    super('尚未選擇聊天，請先在 TauriTavern 開啟一段聊天');
    this.name = 'NoActiveChatError';
  }
}

function getEventTypes(context) {
  return context.eventTypes ?? context.event_types;
}

export function inspectTavernCapabilities(root = globalThis) {
  const missing = [];
  const getContext = root?.SillyTavern?.getContext;

  if (typeof getContext !== 'function') {
    return {
      ok: false,
      missing: ['SillyTavern.getContext'],
      context: null,
    };
  }

  let context;

  try {
    context = getContext.call(root.SillyTavern);
  } catch {
    return {
      ok: false,
      missing: ['可呼叫的 SillyTavern.getContext'],
      context: null,
    };
  }

  if (!context || typeof context !== 'object') {
    return {
      ok: false,
      missing: ['SillyTavern context'],
      context: null,
    };
  }

  if (!context.chatMetadata || typeof context.chatMetadata !== 'object') {
    missing.push('chatMetadata');
  }

  if (typeof context.saveMetadata !== 'function') {
    missing.push('saveMetadata');
  }

  const hasChatId =
    typeof context.getCurrentChatId === 'function' || Object.hasOwn(context, 'chatId');

  if (!hasChatId) {
    missing.push('chatId/getCurrentChatId');
  }

  const eventTypes = getEventTypes(context);

  if (!context.eventSource || typeof context.eventSource.on !== 'function') {
    missing.push('eventSource.on');
  }

  if (!eventTypes || !eventTypes.CHAT_CHANGED) {
    missing.push('eventTypes.CHAT_CHANGED');
  }

  return {
    ok: missing.length === 0,
    missing,
    context,
  };
}

function requireCapabilities(root) {
  const capabilities = inspectTavernCapabilities(root);

  if (!capabilities.ok) {
    throw new TavernCapabilityError(capabilities.missing);
  }

  return capabilities.context;
}

function getChatId(context) {
  const rawChatId =
    typeof context.getCurrentChatId === 'function'
      ? context.getCurrentChatId()
      : context.chatId;

  if (rawChatId === undefined || rawChatId === null || rawChatId === '') {
    throw new NoActiveChatError();
  }

  return String(rawChatId);
}

export class TauriTavernChatStateStore {
  constructor({ root = globalThis, now = () => new Date().toISOString() } = {}) {
    this.root = root;
    this.now = now;
  }

  inspectCapabilities() {
    return inspectTavernCapabilities(this.root);
  }

  getCurrentChatId() {
    return getChatId(requireCapabilities(this.root));
  }

  async read() {
    const context = requireCapabilities(this.root);
    const chatId = getChatId(context);
    const result = migrateChatState(context.chatMetadata[CHAT_METADATA_KEY], this.now());

    if (result.created || result.migrated) {
      context.chatMetadata[CHAT_METADATA_KEY] = result.state;
      await context.saveMetadata();
    }

    return {
      ...result,
      chatId,
    };
  }

  async writeSample(value) {
    const context = requireCapabilities(this.root);
    const chatId = getChatId(context);
    const current = migrateChatState(
      context.chatMetadata[CHAT_METADATA_KEY],
      this.now(),
    ).state;
    const state = setSampleValue(current, value, this.now());

    context.chatMetadata[CHAT_METADATA_KEY] = state;
    await context.saveMetadata();

    return { chatId, state };
  }

  async clearSample() {
    return this.writeSample(null);
  }

  subscribeToChatChanges(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('listener 必須是函式');
    }

    const context = requireCapabilities(this.root);
    const eventName = getEventTypes(context).CHAT_CHANGED;
    const handler = () => listener();

    context.eventSource.on(eventName, handler);

    return () => {
      if (typeof context.eventSource.off === 'function') {
        context.eventSource.off(eventName, handler);
      } else if (typeof context.eventSource.removeListener === 'function') {
        context.eventSource.removeListener(eventName, handler);
      }
    };
  }
}
