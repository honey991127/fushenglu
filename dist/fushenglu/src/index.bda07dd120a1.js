import {
  BrowserApiSettingsStore,
  OpenAICompatibleClient,
} from './core/api-client.07c611401269.js';
import {
  TauriTavernChatStateStore,
  TauriTavernHandoffBridge,
} from './integrations/tauritavern.c23e8e335cb1.js';
import { mountFushengluApp } from './ui/app.3ab28347af31.js';

let appController = null;
let waitingForDocument = false;

export function startFushenglu() {
  if (appController || typeof document === 'undefined') {
    return appController;
  }

  if (!document.body) {
    if (!waitingForDocument) {
      waitingForDocument = true;
      document.addEventListener(
        'DOMContentLoaded',
        () => {
          waitingForDocument = false;
          startFushenglu();
        },
        { once: true },
      );
    }

    return null;
  }

  const store = new TauriTavernChatStateStore();
  let storage = null;

  try {
    storage = globalThis.localStorage;
  } catch {
    // 某些 iOS WebView 隱私模式會拒絕 localStorage；設定 store 會改用記憶體。
  }

  const settingsStore = new BrowserApiSettingsStore({ storage });
  const apiClient = new OpenAICompatibleClient({ settingsStore });
  const handoffBridge = new TauriTavernHandoffBridge({ store });
  const stopHandoff = handoffBridge.start();
  const mounted = mountFushengluApp({ store, settingsStore, apiClient, handoffBridge });
  appController = {
    ...mounted,
    destroy() {
      stopHandoff();
      mounted.destroy();
      appController = null;
    },
  };
  return appController;
}

export function onActivate() {
  startFushenglu();
}

if (typeof document !== 'undefined') {
  queueMicrotask(startFushenglu);
}
