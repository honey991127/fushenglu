import {
  BrowserApiSettingsStore,
  OpenAICompatibleClient,
} from './core/api-client.67c0a94c5335.js';
import {
  TauriTavernChatStateStore,
  TauriTavernHandoffBridge,
  TauriTavernLiveTurnBridge,
} from './integrations/tauritavern.2353b7096e97.js';
import { mountFushengluApp } from './ui/app.a9ee5ab8aeaf.js';

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
  const liveTurnBridge = new TauriTavernLiveTurnBridge({
    queueLiveTurnAnalysis: mounted.queueLiveTurnAnalysis,
  });
  const stopLiveTurn = liveTurnBridge.start();
  appController = {
    ...mounted,
    destroy() {
      stopLiveTurn();
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
