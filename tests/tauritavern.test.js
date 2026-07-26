import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHAT_METADATA_KEY,
  TauriTavernChatStateStore,
  TavernCapabilityError,
  inspectTavernCapabilities,
} from '../src/integrations/tauritavern.js';

const NOW = '2026-07-27T00:00:00.000Z';

function createFakeTavern() {
  let currentChatId = 'chat-a';
  const metadataByChat = new Map();
  const listeners = new Map();
  const saves = [];

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
  };

  const root = {
    SillyTavern: {
      getContext() {
        const capturedChatId = currentChatId;

        return {
          chatId: capturedChatId,
          getCurrentChatId: () => capturedChatId,
          chatMetadata: metadataFor(capturedChatId),
          saveMetadata: async () => {
            saves.push(capturedChatId);
          },
          eventSource,
          eventTypes: {
            CHAT_CHANGED: 'chat_changed',
          },
        };
      },
    },
  };

  return {
    root,
    metadataByChat,
    saves,
    switchChat(chatId) {
      currentChatId = chatId;

      for (const listener of listeners.get('chat_changed') ?? []) {
        listener(chatId);
      }
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

test('示例值在聊天之間完全隔離', async () => {
  const fake = createFakeTavern();
  const store = new TauriTavernChatStateStore({
    root: fake.root,
    now: () => NOW,
  });

  await store.writeSample('只屬於 A');

  fake.switchChat('chat-b');
  const chatBInitial = await store.read();
  assert.equal(chatBInitial.chatId, 'chat-b');
  assert.equal(chatBInitial.state.sampleValue, null);

  await store.writeSample('只屬於 B');

  fake.switchChat('chat-a');
  const chatA = await store.read();
  assert.equal(chatA.state.sampleValue, '只屬於 A');

  fake.switchChat('chat-b');
  const chatB = await store.read();
  assert.equal(chatB.state.sampleValue, '只屬於 B');
});

test('清空只影響目前聊天的示例值', async () => {
  const fake = createFakeTavern();
  const store = new TauriTavernChatStateStore({
    root: fake.root,
    now: () => NOW,
  });

  await store.writeSample('A');
  fake.switchChat('chat-b');
  await store.writeSample('B');
  await store.clearSample();

  assert.equal((await store.read()).state.sampleValue, null);

  fake.switchChat('chat-a');
  assert.equal((await store.read()).state.sampleValue, 'A');
});

test('讀取時會遷移並保存 V0 資料', async () => {
  const fake = createFakeTavern();
  fake.metadataByChat.set('chat-a', {
    [CHAT_METADATA_KEY]: {
      schemaVersion: 0,
      sample: '舊原型',
    },
  });
  const store = new TauriTavernChatStateStore({
    root: fake.root,
    now: () => NOW,
  });

  const result = await store.read();

  assert.equal(result.migrated, true);
  assert.equal(result.state.schemaVersion, 1);
  assert.equal(result.state.sampleValue, '舊原型');
  assert.deepEqual(fake.saves, ['chat-a']);
});

test('可訂閱及取消 CHAT_CHANGED', () => {
  const fake = createFakeTavern();
  const store = new TauriTavernChatStateStore({ root: fake.root });
  let calls = 0;
  const unsubscribe = store.subscribeToChatChanges(() => {
    calls += 1;
  });

  fake.switchChat('chat-b');
  unsubscribe();
  fake.switchChat('chat-c');

  assert.equal(calls, 1);
});
