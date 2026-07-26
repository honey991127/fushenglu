import { NoActiveChatError } from '../integrations/tauritavern.js';

const APP_ROOT_ID = 'fushenglu-extension-root';

function setStatus(elements, message, kind = 'neutral') {
  elements.status.textContent = message;
  elements.status.dataset.kind = kind;
}

function setControlsDisabled(elements, disabled) {
  for (const button of elements.storageButtons) {
    button.disabled = disabled;
  }

  elements.sampleInput.disabled = disabled;
}

function createMarkup(documentRef) {
  const root = documentRef.createElement('div');
  root.id = APP_ROOT_ID;
  root.className = 'fushenglu-extension';
  root.innerHTML = `
    <button
      type="button"
      class="fushenglu-entry"
      aria-controls="fushenglu-fullscreen"
      aria-expanded="false"
    >
      浮生錄
    </button>
    <section
      id="fushenglu-fullscreen"
      class="fushenglu-fullscreen"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fushenglu-title"
      hidden
    >
      <header class="fushenglu-header">
        <div>
          <p class="fushenglu-eyebrow">逐聊天儲存原型</p>
          <h1 id="fushenglu-title">浮生錄</h1>
        </div>
        <button type="button" class="fushenglu-close" aria-label="關閉浮生錄">關閉</button>
      </header>
      <main class="fushenglu-content">
        <section class="fushenglu-card" aria-labelledby="fushenglu-chat-heading">
          <h2 id="fushenglu-chat-heading">目前聊天</h2>
          <output class="fushenglu-chat-id" aria-live="polite">偵測中…</output>
        </section>
        <section class="fushenglu-card" aria-labelledby="fushenglu-storage-heading">
          <h2 id="fushenglu-storage-heading">儲存測試</h2>
          <p class="fushenglu-help">示例值只會保存在目前聊天的 metadata。</p>
          <label class="fushenglu-label" for="fushenglu-sample-value">示例值</label>
          <input
            id="fushenglu-sample-value"
            class="fushenglu-input"
            type="text"
            maxlength="200"
            autocomplete="off"
            placeholder="輸入目前聊天專用的測試文字"
          />
          <div class="fushenglu-actions">
            <button type="button" data-action="write">寫入</button>
            <button type="button" data-action="read">讀取</button>
            <button type="button" data-action="clear">清空</button>
          </div>
          <output class="fushenglu-status" data-kind="neutral" aria-live="polite">
            尚未測試
          </output>
        </section>
      </main>
    </section>
  `;

  return root;
}

export function mountFushengluApp({
  store,
  documentRef = document,
} = {}) {
  if (!store) {
    throw new TypeError('mountFushengluApp 需要 store');
  }

  const existingRoot = documentRef.getElementById(APP_ROOT_ID);

  if (existingRoot) {
    return {
      root: existingRoot,
      destroy() {},
    };
  }

  const root = createMarkup(documentRef);
  documentRef.body.append(root);

  const elements = {
    entry: root.querySelector('.fushenglu-entry'),
    fullscreen: root.querySelector('.fushenglu-fullscreen'),
    close: root.querySelector('.fushenglu-close'),
    chatId: root.querySelector('.fushenglu-chat-id'),
    sampleInput: root.querySelector('.fushenglu-input'),
    storageButtons: [...root.querySelectorAll('[data-action]')],
    status: root.querySelector('.fushenglu-status'),
  };

  let busy = false;
  let lastFocusedElement = null;
  let unsubscribe = () => {};

  function setOpen(open) {
    elements.fullscreen.hidden = !open;
    elements.entry.setAttribute('aria-expanded', String(open));
    documentRef.documentElement.classList.toggle('fushenglu-is-open', open);

    if (open) {
      lastFocusedElement = documentRef.activeElement;
      elements.close.focus();
      void refresh('已重新讀取目前聊天');
    } else if (lastFocusedElement instanceof HTMLElement) {
      lastFocusedElement.focus();
    }
  }

  async function refresh(successMessage = '已讀取目前聊天') {
    const capabilities = store.inspectCapabilities();

    if (!capabilities.ok) {
      elements.chatId.textContent = '無法取得';
      setControlsDisabled(elements, true);
      setStatus(
        elements,
        `缺少必要公開接口：${capabilities.missing.join('、')}`,
        'error',
      );
      return;
    }

    try {
      const result = await store.read();
      elements.chatId.textContent = result.chatId;
      elements.sampleInput.value = result.state.sampleValue ?? '';
      setControlsDisabled(elements, false);

      const suffix =
        result.state.sampleValue === null
          ? '目前沒有示例值'
          : `示例值：${result.state.sampleValue}`;
      const migration = result.migrated ? `；已由 V${result.fromVersion} 遷移` : '';
      setStatus(elements, `${successMessage}；${suffix}${migration}`, 'success');
    } catch (error) {
      elements.chatId.textContent =
        error instanceof NoActiveChatError ? '尚未選擇聊天' : '讀取失敗';
      setControlsDisabled(elements, true);
      setStatus(elements, error instanceof Error ? error.message : String(error), 'error');
    }
  }

  async function runStorageAction(action) {
    if (busy) {
      return;
    }

    busy = true;
    setControlsDisabled(elements, true);
    setStatus(elements, '處理中…');

    try {
      if (action === 'write') {
        const result = await store.writeSample(elements.sampleInput.value);
        elements.chatId.textContent = result.chatId;
        setStatus(elements, '已寫入目前聊天', 'success');
      } else if (action === 'clear') {
        const result = await store.clearSample();
        elements.chatId.textContent = result.chatId;
        elements.sampleInput.value = '';
        setStatus(elements, '已清空目前聊天的示例值', 'success');
      } else {
        await refresh();
      }
    } catch (error) {
      setStatus(elements, error instanceof Error ? error.message : String(error), 'error');
    } finally {
      busy = false;
      const capabilities = store.inspectCapabilities();
      setControlsDisabled(elements, !capabilities.ok);
    }
  }

  elements.entry.addEventListener('click', () => setOpen(true));
  elements.close.addEventListener('click', () => setOpen(false));
  elements.fullscreen.addEventListener('click', (event) => {
    const action = event.target.closest?.('[data-action]')?.dataset.action;

    if (action) {
      void runStorageAction(action);
    }
  });

  const handleKeydown = (event) => {
    if (event.key === 'Escape' && !elements.fullscreen.hidden) {
      setOpen(false);
    }
  };

  documentRef.addEventListener('keydown', handleKeydown);

  try {
    unsubscribe = store.subscribeToChatChanges(() => {
      elements.sampleInput.value = '';
      void refresh('聊天已切換');
    });
  } catch {
    // refresh() 會顯示完整的 capability 錯誤。
  }

  void refresh();

  return {
    root,
    destroy() {
      unsubscribe();
      documentRef.removeEventListener('keydown', handleKeydown);
      documentRef.documentElement.classList.remove('fushenglu-is-open');
      root.remove();
    },
  };
}
