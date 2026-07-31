import {
  migrateChatState,
  setSampleValue,
  validateChatState,
} from '../core/chat-state.7a6c9c9b34f5.js';
import {
  buildIdentityContext,
  buildHandoffInjection,
  consumeNextGeneration,
  recordHandoffInjection,
} from '../core/turn-sync.276a11ab7bab.js';

export const CHAT_METADATA_KEY = 'fushenglu.chatState';
export const HANDOFF_PROMPT_KEY = 'fushenglu.handoff';

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

function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function getEventTypes(context) {
  return context.eventTypes ?? context.event_types;
}

function inspectHandoffCapabilities(context) {
  const missing = [];
  const eventTypes = getEventTypes(context);

  if (typeof context.setExtensionPrompt !== 'function') {
    missing.push('setExtensionPrompt');
  }

  if (typeof context.saveChat !== 'function') {
    missing.push('saveChat');
  }

  if (!eventTypes?.GENERATION_AFTER_COMMANDS && !eventTypes?.GENERATION_STARTED) {
    missing.push('GENERATION_AFTER_COMMANDS/GENERATION_STARTED');
  }

  if (!eventTypes?.MESSAGE_RECEIVED) {
    missing.push('eventTypes.MESSAGE_RECEIVED');
  }

  return {
    ok: missing.length === 0,
    missing,
  };
}

export function inspectTavernCapabilities(root = globalThis) {
  const missing = [];
  const getContext = root?.SillyTavern?.getContext;

  if (typeof getContext !== 'function') {
    return {
      ok: false,
      missing: ['SillyTavern.getContext'],
      context: null,
      handoff: { ok: false, missing: ['SillyTavern.getContext'] },
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
      handoff: { ok: false, missing: ['SillyTavern.getContext'] },
    };
  }

  if (!context || typeof context !== 'object') {
    return {
      ok: false,
      missing: ['SillyTavern context'],
      context: null,
      handoff: { ok: false, missing: ['SillyTavern context'] },
    };
  }

  if (!context.chatMetadata || typeof context.chatMetadata !== 'object') {
    missing.push('chatMetadata');
  }

  if (typeof context.saveMetadata !== 'function') {
    missing.push('saveMetadata');
  }

  if (!Array.isArray(context.chat)) {
    missing.push('chat');
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

  if (!eventTypes?.CHAT_CHANGED) {
    missing.push('eventTypes.CHAT_CHANGED');
  }

  return {
    ok: missing.length === 0,
    missing,
    context,
    handoff: inspectHandoffCapabilities(context),
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

function removeListener(context, eventName, handler) {
  if (typeof context.eventSource.off === 'function') {
    context.eventSource.off(eventName, handler);
  } else if (typeof context.eventSource.removeListener === 'function') {
    context.eventSource.removeListener(eventName, handler);
  }
}

export class TauriTavernChatStateStore {
  constructor({ root = globalThis, now = () => new Date().toISOString() } = {}) {
    this.root = root;
    this.now = now;
    this.writeQueue = Promise.resolve();
  }

  inspectCapabilities() {
    return inspectTavernCapabilities(this.root);
  }

  getCurrentChatId() {
    return getChatId(requireCapabilities(this.root));
  }

  getCurrentMessages() {
    const context = requireCapabilities(this.root);
    getChatId(context);
    return clone(context.chat);
  }

  getIdentityContext() {
    return buildIdentityContext(requireCapabilities(this.root));
  }

  async read() {
    const context = requireCapabilities(this.root);
    const chatId = getChatId(context);
    const result = migrateChatState(context.chatMetadata[CHAT_METADATA_KEY], this.now());

    if (result.created || result.migrated) {
      const previous = context.chatMetadata[CHAT_METADATA_KEY];
      context.chatMetadata[CHAT_METADATA_KEY] = result.state;

      try {
        await context.saveMetadata();
      } catch (error) {
        if (previous === undefined) {
          delete context.chatMetadata[CHAT_METADATA_KEY];
        } else {
          context.chatMetadata[CHAT_METADATA_KEY] = previous;
        }

        throw error;
      }
    }

    return {
      ...result,
      chatId,
      state: clone(result.state),
      messages: clone(context.chat),
      identityContext: buildIdentityContext(context),
    };
  }

  async write(nextState) {
    return this.update(() => nextState);
  }

  async update(updater) {
    if (typeof updater !== 'function') {
      throw new TypeError('updater 必須是函式');
    }

    const operation = async () => {
      const context = requireCapabilities(this.root);
      const chatId = getChatId(context);
      const previousRaw = context.chatMetadata[CHAT_METADATA_KEY];
      const current = migrateChatState(previousRaw, this.now()).state;
      const proposed = await updater(clone(current), {
        chatId,
        messages: clone(context.chat),
        identityContext: buildIdentityContext(context),
      });
      const state = validateChatState(proposed, this.now());
      context.chatMetadata[CHAT_METADATA_KEY] = state;

      try {
        await context.saveMetadata();
      } catch (error) {
        if (previousRaw === undefined) {
          delete context.chatMetadata[CHAT_METADATA_KEY];
        } else {
          context.chatMetadata[CHAT_METADATA_KEY] = previousRaw;
        }

        throw error;
      }

      return { chatId, state: clone(state) };
    };
    const queued = this.writeQueue.then(operation, operation);
    this.writeQueue = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }

  async writeSample(value) {
    return this.update((state) => setSampleValue(state, value, this.now()));
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

    return () => removeListener(context, eventName, handler);
  }
}

export class TauriTavernHandoffBridge {
  constructor({
    store,
    root = globalThis,
    now = () => new Date().toISOString(),
    createGenerationId = () =>
      `generation_${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random()}`}`,
    finalizeDelayMs = 0,
  } = {}) {
    if (!store) {
      throw new TypeError('TauriTavernHandoffBridge 需要 store');
    }

    this.store = store;
    this.root = root;
    this.now = now;
    this.createGenerationId = createGenerationId;
    this.finalizeDelayMs = finalizeDelayMs;
    this.activeGeneration = null;
    this.unsubscribers = [];
  }

  setPrompt(context, text) {
    context.setExtensionPrompt(
      HANDOFF_PROMPT_KEY,
      text,
      1,
      0,
      false,
      0,
    );
  }

  async onGenerationStart(type, _options, dryRun = false) {
    const context = requireCapabilities(this.root);
    const capabilities = inspectHandoffCapabilities(context);

    if (!capabilities.ok) {
      return;
    }

    if (
      dryRun ||
      ['swipe', 'regenerate', 'quiet', 'impersonate'].includes(type)
    ) {
      this.activeGeneration = null;
      this.setPrompt(context, '');
      return;
    }

    const chatId = getChatId(context);
    const generationId = this.createGenerationId();
    let injection = { text: '', itemIds: [] };

    await this.store.update((state) => {
      injection = buildHandoffInjection(state);

      if (injection.itemIds.length === 0) {
        return state;
      }

      return recordHandoffInjection(
        state,
        generationId,
        injection.itemIds,
        this.now(),
      );
    });
    this.setPrompt(context, injection.text);
    this.activeGeneration = {
      generationId,
      chatId,
      type,
      itemIds: injection.itemIds,
      handled: false,
    };
  }

  onGenerationStopped() {
    this.activeGeneration = null;
  }

  onMessageReceived(messageId, type) {
    const generation = this.activeGeneration;

    if (
      !generation ||
      generation.handled ||
      !['normal', 'continue'].includes(generation.type) ||
      ['swipe', 'regenerate'].includes(type)
    ) {
      return;
    }

    generation.handled = true;
    const schedule = this.root.setTimeout?.bind(this.root) ?? setTimeout;
    schedule(() => {
      void this.confirmHostSave(generation, messageId, type);
    }, this.finalizeDelayMs);
  }

  async confirmHostSave(generation, messageId, type) {
    let saved = false;

    try {
      const context = requireCapabilities(this.root);

      if (getChatId(context) !== generation.chatId) {
        return;
      }

      const message = context.chat?.[Number(messageId)];

      if (!message || message.is_user || message.is_system) {
        return;
      }

      await context.saveChat();
      saved = true;
    } finally {
      await this.confirmGenerationSaved({
        generationId: generation.generationId,
        generationType: generation.type || type,
        saved,
      });
    }
  }

  async confirmGenerationSaved({
    generationId,
    generationType = 'normal',
    saved,
  }) {
    await this.store.update((state) =>
      consumeNextGeneration(state, generationId, {
        saved,
        generationType,
        timestamp: this.now(),
      }),
    );

    if (this.activeGeneration?.generationId === generationId) {
      this.activeGeneration = null;
    }
  }

  start() {
    const capabilities = inspectTavernCapabilities(this.root);

    if (!capabilities.ok || !capabilities.handoff.ok) {
      return () => {};
    }

    const context = capabilities.context;
    const eventTypes = getEventTypes(context);
    const generationEvent =
      eventTypes.GENERATION_AFTER_COMMANDS ?? eventTypes.GENERATION_STARTED;
    const generationHandler = (type, options, dryRun) =>
      this.onGenerationStart(type, options, dryRun);
    const receivedHandler = (messageId, type) =>
      this.onMessageReceived(messageId, type);
    const stoppedHandler = () => this.onGenerationStopped();

    context.eventSource.on(generationEvent, generationHandler);
    context.eventSource.on(eventTypes.MESSAGE_RECEIVED, receivedHandler);
    this.unsubscribers.push(() =>
      removeListener(context, generationEvent, generationHandler),
    );
    this.unsubscribers.push(() =>
      removeListener(context, eventTypes.MESSAGE_RECEIVED, receivedHandler),
    );

    if (eventTypes.GENERATION_STOPPED) {
      context.eventSource.on(eventTypes.GENERATION_STOPPED, stoppedHandler);
      this.unsubscribers.push(() =>
        removeListener(context, eventTypes.GENERATION_STOPPED, stoppedHandler),
      );
    }

    return () => this.stop();
  }

  stop() {
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe();
    }

    this.activeGeneration = null;
  }
}
