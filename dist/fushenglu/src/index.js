import { TauriTavernChatStateStore } from './integrations/tauritavern.js';
import { mountFushengluApp } from './ui/app.js';

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
  appController = mountFushengluApp({ store });
  return appController;
}

export function onActivate() {
  startFushenglu();
}

if (typeof document !== 'undefined') {
  queueMicrotask(startFushenglu);
}
