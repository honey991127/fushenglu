import {
  BrowserApiSettingsStore,
  OpenAICompatibleClient,
} from './core/api-client.f774330f64da.js';
import {
  TauriTavernChatStateStore,
  TauriTavernHandoffBridge,
} from './integrations/tauritavern.d6b01857c151.js';
import { mountFushengluApp } from './ui/app.5a2bb07eb836.js';

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
  const mounted = mountFushengluApp({ store, settingsStore, apiClient });
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
