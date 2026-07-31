import test from 'node:test';
import assert from 'node:assert/strict';

import { createChatState } from '../src/core/chat-state.js';
import {
  CHAT_METADATA_KEY,
  HANDOFF_PROMPT_KEY,
  TauriTavernChatStateStore,
  TauriTavernHandoffBridge,
  TavernCapabilityError,
  inspectTavernCapabilities,
} from '../src/integrations/tauritavern.js';

const NOW = '2026-07-27T00:00:00.000Z';

function createFakeTavern() {
  let currentChatId = 'chat-a';
  const metadataByChat = new Map();
  const chatById = new Map([
    ['chat-a', []],
    ['chat-b', []],
  ]);
  const listeners = new Map();
  const saves = [];
  const chatSaves = [];
  const prompts = new Map();

  function metadataFor(chatId) {
    if (!metadataByChat.has(chatId)) {
      metadataByChat.set(chatId, {});
    }

    return metadataByChat.get(chatId);
  }

  const eventSource = {
    on(eventName, listener) {
      const eventListeners = listeners.get(eventName) ?? new Set();
      eventListeners.add(listener);
      listeners.set(eventName, eventListeners);
    },
    off(eventName, listener) {
      listeners.get(eventName)?.delete(listener);
    },
    async emit(eventName, ...args) {
      for (const listener of listeners.get(eventName) ?? []) {
        await listener(...args);
      }
    },
  };

  const eventTypes = {
    CHAT_CHANGED: 'chat_changed',
    GENERATION_AFTER_COMMANDS: 'generation_after_commands',
    GENERATION_STOPPED: 'generation_stopped',
    MESSAGE_RECEIVED: 'message_received',
  };
  const root = {
    setTimeout,
    SillyTavern: {
      getContext() {
        const capturedChatId = currentChatId;

        return {
          chatId: capturedChatId,
          getCurrentChatId: () => capturedChatId,
          chatMetadata: metadataFor(capturedChatId),
          chat: chatById.get(capturedChatId) ?? [],
          saveMetadata: async () => {
            saves.push(capturedChatId);
          },
          saveChat: async () => {
            chatSaves.push(capturedChatId);
          },
          setExtensionPrompt(key, text, position, depth, scan, role) {
            prompts.set(key, { text, position, depth, scan, role });
          },
          eventSource,
          eventTypes,
        };
      },
    },
  };

  return {
    root,
    metadataByChat,
    chatById,
    saves,
    chatSaves,
    prompts,
    eventSource,
    switchChat(chatId) {
      currentChatId = chatId;

      if (!chatById.has(chatId)) {
        chatById.set(chatId, []);
      }

      void eventSource.emit('chat_changed', chatId);
    },
  };
}

test('capability detection 會列出缺少的公開接口', () => {
  const result = inspectTavernCapabilities({});

  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['SillyTavern.getContext']);
});

test('缺少接口時儲存操作會拒絕執行', async () => {
  const store = new TauriTavernChatStateStore({ root: {} });

  await assert.rejects(store.read(), TavernCapabilityError);
});

test('不同聊天的 V2 資料完全隔離', async () => {
  const fake = createFakeTavern();
  const store = new TauriTavernChatStateStore({
    root: fake.root,
    now: () => NOW,
  });

  await store.update((state) => ({
    ...state,
    committedBatchIds: ['batch-a'],
    updatedAt: NOW,
  }));

  fake.switchChat('chat-b');
  const chatBInitial = await store.read();
  assert.equal(chatBInitial.chatId, 'chat-b');
  assert.deepEqual(chatBInitial.state.committedBatchIds, []);

  await store.update((state) => ({
    ...state,
    committedBatchIds: ['batch-b'],
    updatedAt: NOW,
  }));

  fake.switchChat('chat-a');
  assert.deepEqual((await store.read()).state.committedBatchIds, ['batch-a']);

  fake.switchChat('chat-b');
  assert.deepEqual((await store.read()).state.committedBatchIds, ['batch-b']);
});

test('第一階段示例資料遷移後仍只影響目前聊天', async () => {
  const fake = createFakeTavern();
  fake.metadataByChat.set('chat-a', {
    [CHAT_METADATA_KEY]: {
      schemaVersion: 1,
      sampleValue: '舊原型',
      updatedAt: NOW,
    },
  });
  const store = new TauriTavernChatStateStore({
    root: fake.root,
    now: () => NOW,
  });

  const result = await store.read();
  assert.equal(result.migrated, true);
  assert.equal(result.state.schemaVersion, 5);
  assert.equal(result.state.legacy.sampleValue, '舊原型');

  fake.switchChat('chat-b');
  await store.writeSample('B');
  assert.equal((await store.read()).state.legacy.sampleValue, 'B');

  fake.switchChat('chat-a');
  assert.equal((await store.read()).state.legacy.sampleValue, '舊原型');
});

test('可訂閱及取消 CHAT_CHANGED', async () => {
  const fake = createFakeTavern();
  const store = new TauriTavernChatStateStore({ root: fake.root });
  let calls = 0;
  const unsubscribe = store.subscribeToChatChanges(() => {
    calls += 1;
  });

  fake.switchChat('chat-b');
  await new Promise((resolve) => setTimeout(resolve, 0));
  unsubscribe();
  fake.switchChat('chat-c');
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(calls, 1);
});

test('最小交接只在 assistant 回覆保存成功後消耗 next_generation', async () => {
  const fake = createFakeTavern();
  const state = createChatState(NOW);
  state.handoffItems.push({
    schemaVersion: 1,
    handoffId: 'handoff-1',
    batchId: 'batch-1',
    text: '位置：藏書閣',
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
  fake.metadataByChat.set('chat-a', { [CHAT_METADATA_KEY]: state });
  fake.chatById.get('chat-a').push({
    id: 'assistant-1',
    is_user: false,
    mes: '回覆',
    gen_finished: NOW,
  });
  const store = new TauriTavernChatStateStore({
    root: fake.root,
    now: () => NOW,
  });
  const bridge = new TauriTavernHandoffBridge({
    store,
    root: fake.root,
    now: () => NOW,
    createGenerationId: () => 'generation-1',
  });
  const stop = bridge.start();

  await fake.eventSource.emit('generation_after_commands', 'normal', {}, false);
  assert.match(fake.prompts.get(HANDOFF_PROMPT_KEY).text, /藏書閣/);

  await fake.eventSource.emit('message_received', 0, 'normal');
  await new Promise((resolve) => setTimeout(resolve, 10));

  const saved = await store.read();
  assert.equal(saved.state.handoffItems[0].active, false);
  assert.equal(saved.state.handoffItems[0].consumedAt, NOW);
  assert.deepEqual(fake.chatSaves, ['chat-a']);
  stop();
});
