import { Window } from 'happy-dom';
import { BrowserApiSettingsStore } from '../../src/core/api-client.js';
import { TauriTavernChatStateStore, CHAT_METADATA_KEY } from '../../src/integrations/tauritavern.js';

export function flush() { return new Promise((resolve) => setTimeout(resolve, 0)); }
export function createDomApp(stateByChat, { failSave = false } = {}) {
  const window = new Window(); const listeners = new Map(); let chatId = 'chat:one'; let saves = 0; let shouldFailSave = failSave;
  const context = { chat: [], chatMetadata: {}, getCurrentChatId: () => chatId, eventSource: { on(name, fn) { (listeners.get(name) ?? listeners.set(name, new Set()).get(name)).add(fn); }, off(name, fn) { listeners.get(name)?.delete(fn); } }, eventTypes: { CHAT_CHANGED: 'chat_changed', GENERATION_AFTER_COMMANDS: 'start', GENERATION_STOPPED: 'stop', MESSAGE_RECEIVED: 'received' }, async saveMetadata() { saves++; if (shouldFailSave) throw new Error('保存失敗，可重試'); stateByChat.set(chatId, context.chatMetadata[CHAT_METADATA_KEY]); }, async saveChat() {}, setExtensionPrompt() {} };
  context.chatMetadata[CHAT_METADATA_KEY] = stateByChat.get(chatId);
  const host = { SillyTavern: { getContext: () => context } };
  const store = new TauriTavernChatStateStore({ root: host, now: () => '2026-08-01T00:00:00.000Z' });
  return { window, document: window.document, store, settingsStore: new BrowserApiSettingsStore(), context, host, listeners, get saves() { return saves; }, set failSave(value) { shouldFailSave = value; }, switchChat(next) { chatId = next; context.chatMetadata[CHAT_METADATA_KEY] = stateByChat.get(next); for (const fn of listeners.get('chat_changed') ?? []) fn(); }, destroy() { window.happyDOM.cancelAsync(); window.close(); } };
}

