import { maskApiKey } from '../core/api-client.js';
import {
  createEmptyAnalysisResult,
  mergeAnalysisResults,
  splitAnalysisMessages,
} from '../core/analysis-schema.js';
import { createCharacterAction } from '../core/character-state.js';
import {
  analysisResultFromBatch,
  listIncompleteProposals,
} from '../core/proposal-repair.js';
import {
  addDraftAction,
  beginTurnBatch,
  cancelBatch,
  commitBatch,
  completeBatch,
  completeBatchAnalysis,
  createDraftTestAction,
  failBatch,
  getBatch,
  getResumableBatch,
  prepareBatchHandoff,
  recoverCertainActionsOnly,
  refreshBatchAnalysis,
  resolvePendingItem,
  retryBatch,
  startBatchCommit,
  undoLatestCommittedBatch,
  updateBatchHandoffDraft,
  updateBatchProposal,
  updateHandoffItem,
  normalizeChatMessages,
} from '../core/turn-sync.js';
import { NoActiveChatError } from '../integrations/tauritavern.js';

const APP_ROOT_ID = 'fushenglu-extension-root';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatActionValue(action) {
  const value = action?.value;

  if (typeof value === 'string') {
    return value;
  }

  if (!value || typeof value !== 'object') {
    return String(value ?? '');
  }

  const operationLabels = {
    add: '增加',
    subtract: '減少',
    set: '設定為',
    wear: '換上',
    save_outfit: '保存穿搭',
    confirm_milestone: '確認里程碑',
    record_breakthrough: '記錄突破',
  };
  const operation = operationLabels[action.operation] ?? action.operation;

  if (action.kind === 'currency') {
    return `${value.name || value.currency || '未命名貨幣'}：${operation} ${value.amount ?? value.quantity ?? 0}`;
  }

  if (action.kind === 'inventory') {
    return `${value.name || '未命名物品'}：${operation} ${value.quantity ?? value.amount ?? 0}`;
  }

  if (action.kind === 'wardrobe') {
    const garments = Array.isArray(value.garments)
      ? value.garments.map((item) => item?.name ?? item).filter(Boolean).join('、')
      : value.name;
    return `衣櫥：${operation}${garments ? ` ${garments}` : ''}`;
  }

  if (action.kind === 'skill') {
    return `${value.name || '未命名技能'}：${operation} ${value.proficiency ?? value.value ?? 0}`;
  }

  if (action.kind === 'cultivation') {
    return `修煉：${operation} ${value.stage || value.name || '未命名階段'}`;
  }

  return safeJson(value);
}

function parseEditedValue(value) {
  const text = String(value ?? '').trim();

  if (!text) {
    return '';
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function makeId(prefix) {
  return `${prefix}_${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
}

function now() {
  return new Date().toISOString();
}

function createMarkup(documentRef) {
  const root = documentRef.createElement('div');
  root.id = APP_ROOT_ID;
  root.className = 'fushenglu-extension';
  root.dataset.mode = 'immersive';
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
          <p class="fushenglu-eyebrow">每輪同步</p>
          <h1 id="fushenglu-title">浮生錄</h1>
        </div>
        <div class="fushenglu-header-actions">
          <button type="button" data-action="toggle-mode" aria-pressed="false">管理</button>
          <button type="button" class="fushenglu-close" data-action="close" aria-label="關閉浮生錄">關閉</button>
        </div>
      </header>
      <output class="fushenglu-global-status" data-kind="neutral" aria-live="polite">
        準備中…
      </output>
      <main class="fushenglu-content">
        <section class="fushenglu-screen" data-screen="home"></section>
        <section class="fushenglu-screen" data-screen="review" hidden></section>
        <section class="fushenglu-screen" data-screen="pending" hidden></section>
        <section class="fushenglu-screen" data-screen="handoff" hidden></section>
        <section class="fushenglu-screen" data-screen="history" hidden></section>
        <section class="fushenglu-screen" data-screen="api" hidden></section>
        <section class="fushenglu-screen" data-screen="inventory" hidden></section>
        <section class="fushenglu-screen" data-screen="wardrobe" hidden></section>
        <section class="fushenglu-screen" data-screen="skills" hidden></section>
        <section class="fushenglu-screen" data-screen="cultivation" hidden></section>
      </main>
      <nav class="fushenglu-nav" aria-label="浮生錄頁面">
        <button type="button" data-nav="home" aria-current="page">首頁</button>
        <button type="button" data-nav="review">本輪</button>
        <button type="button" data-nav="pending">待確認</button>
        <button type="button" data-nav="handoff">交接</button>
        <button type="button" data-nav="history">歷史</button>
        <button type="button" data-nav="api">API</button>
      </nav>
    </section>
  `;
  return root;
}

function statusLabel(status) {
  const labels = {
    draft: '暫存',
    analysis_pending: '分析中',
    review_ready: '待最後確認',
    committing: '提交中',
    committed: '已提交',
    handoff_pending: '準備交接',
    complete: '完成',
    failed: '失敗',
  };
  return labels[status] ?? status;
}

function pendingLabel(kind) {
  const labels = {
    story_time: '故事時間',
    inventory_currency: '貨幣與物品',
    wardrobe: '衣物所有權',
    person: '人物',
    place: '地點',
    skill: '技能',
    cultivation: '修煉',
    evaluation: '評價',
    conflict: '資料衝突',
    other: '其他',
  };
  return labels[kind] ?? kind;
}

function renderProposal(item, batch) {
  const checked = item.reviewDisposition === 'apply' ? 'checked' : '';
  return `
    <article class="fushenglu-change" data-proposal="${escapeHtml(item.proposalId)}">
      <div class="fushenglu-change-head">
        <label class="fushenglu-check">
          <input
            type="checkbox"
            data-action="toggle-proposal"
            data-batch-id="${escapeHtml(batch.batchId)}"
            data-proposal-id="${escapeHtml(item.proposalId)}"
            ${checked}
          />
          <span>${escapeHtml(item.kind)} · ${escapeHtml(item.operation)}</span>
        </label>
        <select
          data-action="proposal-disposition"
          data-batch-id="${escapeHtml(batch.batchId)}"
          data-proposal-id="${escapeHtml(item.proposalId)}"
          aria-label="候選處理方式"
        >
          <option value="apply" ${item.reviewDisposition === 'apply' ? 'selected' : ''}>套用</option>
          <option value="pending" ${item.reviewDisposition === 'pending' ? 'selected' : ''}>待確認</option>
          <option value="reject" ${item.reviewDisposition === 'reject' ? 'selected' : ''}>不採用</option>
        </select>
      </div>
      <label class="fushenglu-label">
        操作
        <input class="fushenglu-input" data-proposal-operation value="${escapeHtml(item.operation)}" />
      </label>
      <label class="fushenglu-label">
        內容
        <textarea class="fushenglu-textarea" data-proposal-value>${escapeHtml(safeJson(item.value))}</textarea>
      </label>
      <button
        type="button"
        class="fushenglu-small-button"
        data-action="save-proposal"
        data-batch-id="${escapeHtml(batch.batchId)}"
        data-proposal-id="${escapeHtml(item.proposalId)}"
      >儲存修改</button>
      <dl class="fushenglu-management-only fushenglu-meta">
        <div><dt>信心</dt><dd>${escapeHtml(item.confidence)}</dd></div>
        <div><dt>嚴重度</dt><dd>${escapeHtml(item.severity)}</dd></div>
        <div><dt>理由</dt><dd>${escapeHtml(item.reason)}</dd></div>
        <div><dt>去重鍵</dt><dd>${escapeHtml(item.dedupeKey)}</dd></div>
        <div><dt>證據</dt><dd>${escapeHtml(item.evidenceMessageRef)}</dd></div>
        ${item.timelineContext ? `<div><dt>時間語境</dt><dd>${escapeHtml(item.timelineContext)}</dd></div>` : ''}
      </dl>
    </article>
  `;
}

function renderHandoffDraft(draft, batch) {
  return `
    <article class="fushenglu-change">
      <label class="fushenglu-check">
        <input
          type="checkbox"
          data-action="handoff-draft-active"
          data-batch-id="${escapeHtml(batch.batchId)}"
          data-draft-id="${escapeHtml(draft.draftId)}"
          ${draft.active ? 'checked' : ''}
        />
        <span>提供給主聊天</span>
      </label>
      <textarea
        class="fushenglu-textarea"
        data-handoff-draft-text
      >${escapeHtml(draft.text)}</textarea>
      <select
        data-action="handoff-draft-mode"
        data-batch-id="${escapeHtml(batch.batchId)}"
        data-draft-id="${escapeHtml(draft.draftId)}"
      >
        <option value="until_changed" ${draft.mode === 'until_changed' ? 'selected' : ''}>直到改變</option>
        <option value="next_generation" ${draft.mode === 'next_generation' ? 'selected' : ''}>只提供下一輪</option>
        <option value="never" ${draft.mode === 'never' ? 'selected' : ''}>不提供</option>
      </select>
      <button
        type="button"
        class="fushenglu-small-button"
        data-action="save-handoff-draft"
        data-batch-id="${escapeHtml(batch.batchId)}"
        data-draft-id="${escapeHtml(draft.draftId)}"
      >儲存交接</button>
    </article>
  `;
}

export function mountFushengluApp({
  store,
  settingsStore,
  apiClient,
  documentRef = document,
} = {}) {
  if (!store || !settingsStore || !apiClient) {
    throw new TypeError('mountFushengluApp 需要 store、settingsStore 與 apiClient');
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
    content: root.querySelector('.fushenglu-content'),
    status: root.querySelector('.fushenglu-global-status'),
    screens: new Map(
      [...root.querySelectorAll('[data-screen]')].map((screen) => [
        screen.dataset.screen,
        screen,
      ]),
    ),
    navButtons: [...root.querySelectorAll('[data-nav]')],
    modeButton: root.querySelector('[data-action="toggle-mode"]'),
  };
  let state = null;
  let chatId = null;
  let currentScreen = 'home';
  let busy = false;
  let loadedModels = [];
  let liveMessageCapability = null;
  let lastFocusedElement = null;
  let unsubscribe = () => {};

  function setStatus(message, kind = 'neutral') {
    elements.status.textContent = message;
    elements.status.dataset.kind = kind;
  }

  function setBusy(nextBusy) {
    busy = nextBusy;

    for (const control of root.querySelectorAll(
      'button[data-action], button[data-nav], input, textarea, select',
    )) {
      if (control.dataset.action !== 'close') {
        control.disabled = nextBusy;
      }
    }
  }

  function showScreen(name) {
    currentScreen = elements.screens.has(name) ? name : 'home';

    for (const [screenName, screen] of elements.screens) {
      screen.hidden = screenName !== currentScreen;
    }

    for (const button of elements.navButtons) {
      button.setAttribute(
        'aria-current',
        button.dataset.nav === currentScreen ? 'page' : 'false',
      );
    }

    elements.content.scrollTop = 0;
  }

  function renderHome() {
    const screen = elements.screens.get('home');
    const activePending =
      state?.pendingItems.filter((item) =>
        ['pending', 'edited', 'deferred'].includes(item.status),
      ).length ?? 0;
    const latestBatch = state?.batches.at(-1) ?? null;
    const limitation = liveMessageCapability
      ? liveMessageCapability.limitation
      : state?.sync.limitation;
    screen.innerHTML = `
      <section class="fushenglu-hero">
        <p>目前聊天</p>
        <h2>${escapeHtml(chatId ?? '尚未選擇')}</h2>
        <div class="fushenglu-stat-row">
          <span>暫存 ${state?.draftActions.length ?? 0}</span>
          <span>待確認 ${activePending}</span>
          <span>${latestBatch ? statusLabel(latestBatch.status) : '尚無批次'}</span>
        </div>
      </section>
      ${
        limitation
          ? `<aside class="fushenglu-notice" data-kind="warning">${escapeHtml(limitation)}</aside>`
          : ''
      }
      <section class="fushenglu-card">
        <h2>本輪操作</h2>
        <p class="fushenglu-help">第二階段只保存測試操作，不建立商店或衣櫥。</p>
        <label class="fushenglu-label" for="fushenglu-test-action">測試操作</label>
        <div class="fushenglu-inline-form">
          <input id="fushenglu-test-action" class="fushenglu-input" maxlength="200" placeholder="例如：記錄一項確定操作" />
          <button type="button" data-action="add-test-action">暫存</button>
        </div>
        <ul class="fushenglu-plain-list">
          ${(state?.draftActions ?? [])
            .map((action) => `<li>${escapeHtml(formatActionValue(action))}</li>`)
            .join('') || '<li class="fushenglu-muted">本輪沒有插件操作也可結束。</li>'}
        </ul>
      </section>
      <section class="fushenglu-card">
        <h2>自然語言修正</h2>
        <textarea id="fushenglu-correction" class="fushenglu-textarea" placeholder="我沒有收下那件披風"></textarea>
        <button type="button" class="fushenglu-secondary-button" data-action="analyze-correction">建立修改預覽</button>
      </section>
      <section class="fushenglu-card">
        <h2>讀取既有聊天</h2>
        <p class="fushenglu-help">既有樓層會自動分成小段逐段分析，再合併為一次預覽。某段失敗時只會從該段繼續；最後確認前不會寫入正式資料。</p>
        <button type="button" class="fushenglu-secondary-button" data-action="scan-existing-chat">掃描既有聊天樓層</button>
      </section>
      <div class="fushenglu-sticky-action">
        <button type="button" class="fushenglu-primary-button" data-action="end-turn">結束本輪</button>
      </div>
    `;
  }

  function characterOverviewMarkup() {
    const character = state?.character;
    const currentOutfit = character?.wardrobe?.currentOutfit;
    const currencies = character?.inventory?.currencies ?? [];
    const change = character?.story?.lastConfirmedChange;
    const statuses = character?.story?.ongoingStatuses ?? [];
    const valueOrEmpty = (value) => escapeHtml(value || '尚未記錄');

    return `
      <section class="fushenglu-card fushenglu-character-overview">
        <h2>角色概覽</h2>
        <dl class="fushenglu-overview-list">
          <div><dt>故事時間</dt><dd>${valueOrEmpty(character?.story?.time)}</dd></div>
          <div><dt>當前地點</dt><dd>${valueOrEmpty(character?.story?.place)}</dd></div>
          <div><dt>當前穿著</dt><dd>${valueOrEmpty(currentOutfit?.name || currentOutfit?.garmentNames?.join('、'))}</dd></div>
          <div><dt>貨幣</dt><dd>${valueOrEmpty(currencies.map((item) => `${item.name} ${item.amount}`).join('、'))}</dd></div>
          <div><dt>傷勢／持續狀態</dt><dd>${valueOrEmpty(statuses.join('、'))}</dd></div>
          <div><dt>最近確認變化</dt><dd>${valueOrEmpty(change ? `${change.kind} · ${change.operation}` : null)}</dd></div>
        </dl>
      </section>
      <section class="fushenglu-entry-grid" aria-label="角色狀態入口">
        <button type="button" data-action="open-screen" data-screen="inventory"><strong>行囊</strong><span>物品與貨幣</span></button>
        <button type="button" data-action="open-screen" data-screen="wardrobe"><strong>衣櫥</strong><span>衣物與穿搭</span></button>
        <button type="button" data-action="open-screen" data-screen="skills"><strong>技能</strong><span>熟練度與來源</span></button>
        <button type="button" data-action="open-screen" data-screen="cultivation"><strong>修煉</strong><span>里程碑與突破</span></button>
      </section>
    `;
  }

  function renderCharacterOverview() {
    const screen = elements.screens.get('home');
    screen.insertAdjacentHTML('afterbegin', characterOverviewMarkup());
  }

  function renderInventory() {
    const screen = elements.screens.get('inventory');
    const inventory = state?.character?.inventory;
    const currencies = inventory?.currencies ?? [];
    const items = inventory?.items ?? [];
    screen.innerHTML = `
      <section class="fushenglu-section-heading"><div><p>已確認資料</p><h2>行囊</h2></div><button type="button" data-action="open-screen" data-screen="home">返回首頁</button></section>
      <section class="fushenglu-card"><h2>貨幣</h2><ul class="fushenglu-plain-list">${currencies.map((item) => `<li>${escapeHtml(item.name)}：${escapeHtml(item.amount)}</li>`).join('') || '<li class="fushenglu-muted">尚未記錄</li>'}</ul>
        <div class="fushenglu-inline-form"><input class="fushenglu-input" data-currency-name value="靈石" placeholder="貨幣名稱（靈石不分品級）" /><input class="fushenglu-input" data-currency-amount type="number" min="0" placeholder="數值" /></div>
        <div class="fushenglu-actions"><button type="button" data-action="queue-currency" data-operation="add">增加</button><button type="button" data-action="queue-currency" data-operation="subtract">減少</button><button type="button" data-action="queue-currency" data-operation="set">設定數量</button></div>
      </section>
      <section class="fushenglu-card"><h2>物品</h2><ul class="fushenglu-plain-list">${items.map((item) => `<li><strong>${escapeHtml(item.name)}</strong> × ${escapeHtml(item.quantity)}<br><span class="fushenglu-muted">${escapeHtml(item.category)}${item.source ? ` · ${escapeHtml(item.source)}` : ''}</span></li>`).join('') || '<li class="fushenglu-muted">尚未記錄</li>'}</ul>
        <label class="fushenglu-label">名稱<input class="fushenglu-input" data-item-name /></label><div class="fushenglu-two-columns"><label class="fushenglu-label">數量<input class="fushenglu-input" data-item-quantity type="number" min="0" /></label><label class="fushenglu-label">分類<input class="fushenglu-input" data-item-category /></label></div><label class="fushenglu-label">來源說明<input class="fushenglu-input" data-item-source /></label>
        <div class="fushenglu-actions"><button type="button" data-action="queue-item" data-operation="add">增加</button><button type="button" data-action="queue-item" data-operation="subtract">減少</button><button type="button" data-action="queue-item" data-operation="set">設定數量</button></div>
      </section>`;
  }

  function renderWardrobe() {
    const screen = elements.screens.get('wardrobe');
    const wardrobe = state?.character?.wardrobe;
    const garments = wardrobe?.garments ?? [];
    const outfit = wardrobe?.currentOutfit;
    screen.innerHTML = `
      <section class="fushenglu-section-heading"><div><p>已確認資料</p><h2>衣櫥</h2></div><button type="button" data-action="open-screen" data-screen="home">返回首頁</button></section>
      <section class="fushenglu-card"><h2>當前穿著</h2><p>${escapeHtml(outfit?.name || outfit?.garmentNames?.join('、') || '尚未記錄')}</p><label class="fushenglu-label">衣物名稱（以逗號分隔）<input class="fushenglu-input" data-outfit-garments placeholder="只可選明確擁有的衣物" /></label><label class="fushenglu-label">穿搭名稱（可留空）<input class="fushenglu-input" data-outfit-name /></label><div class="fushenglu-actions"><button type="button" class="fushenglu-primary-button" data-action="queue-wear">確認換裝預覽</button><button type="button" data-action="queue-save-outfit">保存穿搭</button></div></section>
      <section class="fushenglu-card"><h2>衣物資料庫</h2><ul class="fushenglu-plain-list">${garments.map((item) => `<li><strong>${escapeHtml(item.name)}</strong> · ${escapeHtml(item.part)}<br><span class="fushenglu-muted">${escapeHtml(item.ownershipStatus)}${item.description ? ` · ${escapeHtml(item.description)}` : ''}</span></li>`).join('') || '<li class="fushenglu-muted">尚未記錄</li>'}</ul><label class="fushenglu-label">名稱<input class="fushenglu-input" data-garment-name /></label><div class="fushenglu-two-columns"><label class="fushenglu-label">部位<input class="fushenglu-input" data-garment-part /></label><label class="fushenglu-label">所有權<select data-garment-ownership><option value="owned">明確擁有</option><option value="gifted">贈送</option><option value="borrowed">借用</option><option value="temporary">暫穿</option><option value="unknown">不明</option></select></label></div><label class="fushenglu-label">描述<input class="fushenglu-input" data-garment-description /></label><label class="fushenglu-label">取得來源<input class="fushenglu-input" data-garment-source /></label><button type="button" class="fushenglu-secondary-button" data-action="queue-garment">加入變化預覽</button></section>`;
  }

  function renderSkills() {
    const screen = elements.screens.get('skills');
    const skills = state?.character?.skills?.entries ?? [];
    screen.innerHTML = `
      <section class="fushenglu-section-heading"><div><p>純數值熟練度</p><h2>技能</h2></div><button type="button" data-action="open-screen" data-screen="home">返回首頁</button></section>
      <section class="fushenglu-card"><ul class="fushenglu-plain-list">${skills.map((item) => `<li><strong>${escapeHtml(item.name)}</strong> · ${escapeHtml(item.category)}：${escapeHtml(item.proficiency)}<br><span class="fushenglu-muted">來源：${escapeHtml(item.sourceEvent?.source || '尚未記錄')}；最近變化：${escapeHtml(item.recentChange?.operation || '尚未記錄')}</span></li>`).join('') || '<li class="fushenglu-muted">尚未記錄</li>'}</ul><label class="fushenglu-label">名稱<input class="fushenglu-input" data-skill-name /></label><div class="fushenglu-two-columns"><label class="fushenglu-label">分類<input class="fushenglu-input" data-skill-category /></label><label class="fushenglu-label">熟練度／增加值<input class="fushenglu-input" data-skill-value type="number" min="0" /></label></div><label class="fushenglu-label">來源事件<input class="fushenglu-input" data-skill-source /></label><div class="fushenglu-actions"><button type="button" data-action="queue-skill" data-operation="add">增加</button><button type="button" data-action="queue-skill" data-operation="set">設定數值</button></div></section>`;
  }

  function renderCultivation() {
    const screen = elements.screens.get('cultivation');
    const cultivation = state?.character?.cultivation;
    const current = cultivation?.current;
    const milestones = cultivation?.milestones ?? [];
    const breakthroughs = cultivation?.breakthroughs ?? [];
    screen.innerHTML = `
      <section class="fushenglu-section-heading"><div><p>與技能分開記錄</p><h2>修煉</h2></div><button type="button" data-action="open-screen" data-screen="home">返回首頁</button></section>
      <section class="fushenglu-card"><h2>當前進度</h2><p>${escapeHtml(current ? `${current.stage}${current.progressDescription ? `：${current.progressDescription}` : ''}` : '尚未記錄')}</p><label class="fushenglu-label">境界或階段名稱<input class="fushenglu-input" data-cultivation-stage /></label><label class="fushenglu-label">當前進度描述<input class="fushenglu-input" data-cultivation-progress /></label><label class="fushenglu-label">里程碑名稱<input class="fushenglu-input" data-cultivation-milestone /></label><div class="fushenglu-actions"><button type="button" data-action="queue-cultivation" data-operation="confirm_milestone">確認里程碑預覽</button><button type="button" data-action="queue-cultivation" data-operation="record_breakthrough">突破預覽</button></div></section>
      <section class="fushenglu-card"><h2>已確認里程碑</h2><ul class="fushenglu-plain-list">${milestones.map((item) => `<li>${escapeHtml(item.name)} · ${escapeHtml(item.stage)}</li>`).join('') || '<li class="fushenglu-muted">尚未記錄</li>'}</ul><h2>突破記錄</h2><ul class="fushenglu-plain-list">${breakthroughs.map((item) => `<li>${escapeHtml(item.stage)} · ${escapeHtml(item.confirmedAt)}</li>`).join('') || '<li class="fushenglu-muted">尚未記錄</li>'}</ul></section>`;
  }

  function reviewBatch() {
    return (
      getResumableBatch(state) ??
      [...state.batches].reverse().find((batch) => batch.source !== 'pending_resolution') ??
      null
    );
  }

  function renderReview() {
    const screen = elements.screens.get('review');
    const batch = state ? reviewBatch() : null;

    if (!batch) {
      screen.innerHTML = `
        <section class="fushenglu-empty">
          <h2>尚無本輪預覽</h2>
          <p>回到首頁按「結束本輪」。</p>
        </section>
      `;
      return;
    }

    const actions = batch.draftActions
      .map(
        (action) => `
          <li>
            <label class="fushenglu-check">
              <input type="checkbox" checked disabled />
              <span>${escapeHtml(formatActionValue(action))}</span>
            </label>
          </li>
        `,
      )
      .join('');
    const changes = batch.detectedChanges.map((item) => renderProposal(item, batch)).join('');
    const uncertain = batch.uncertainItems.map((item) => renderProposal(item, batch)).join('');
    let footer = '';

    if (batch.status === 'failed') {
      footer = `
        <div class="fushenglu-action-stack">
          <button type="button" class="fushenglu-primary-button" data-action="retry-batch" data-batch-id="${escapeHtml(batch.batchId)}">重新分析／繼續</button>
          ${
            batch.failurePhase === 'analysis'
              ? `<button type="button" data-action="certain-only" data-batch-id="${escapeHtml(batch.batchId)}">只提交插件內確定操作</button>`
              : ''
          }
          <button type="button" class="fushenglu-danger-button" data-action="cancel-batch" data-batch-id="${escapeHtml(batch.batchId)}">取消本輪</button>
        </div>
      `;
    } else if (batch.status === 'review_ready') {
      footer = `
        <div class="fushenglu-action-stack">
          <button type="button" class="fushenglu-primary-button" data-action="confirm-batch" data-batch-id="${escapeHtml(batch.batchId)}">最後確認提交</button>
          <button type="button" class="fushenglu-danger-button" data-action="cancel-batch" data-batch-id="${escapeHtml(batch.batchId)}">取消整個批次</button>
        </div>
      `;
    } else if (!['complete'].includes(batch.status)) {
      footer = `
        <button type="button" class="fushenglu-primary-button" data-action="resume-batch" data-batch-id="${escapeHtml(batch.batchId)}">繼續完成</button>
      `;
    }

    screen.innerHTML = `
      <section class="fushenglu-section-heading">
        <div>
          <p>${batch.source === 'correction' ? '修改預覽' : '本輪變化預覽'}</p>
          <h2>${statusLabel(batch.status)}</h2>
        </div>
        <span class="fushenglu-badge">${escapeHtml(batch.batchId.slice(-8))}</span>
      </section>
      ${
        batch.failureMessage
          ? `<aside class="fushenglu-notice" data-kind="error">${escapeHtml(batch.failureMessage)}</aside>`
          : ''
      }
      <section class="fushenglu-card">
        <h2>玩家暫存操作</h2>
        <ul class="fushenglu-review-list">${actions || '<li class="fushenglu-muted">無</li>'}</ul>
      </section>
      <section class="fushenglu-card">
        <h2>聊天辨識變化</h2>
        ${changes || '<p class="fushenglu-muted">沒有候選變化。</p>'}
      </section>
      <section class="fushenglu-card">
        <h2>不確定事項</h2>
        ${uncertain || '<p class="fushenglu-muted">沒有不確定事項。</p>'}
      </section>
      <section class="fushenglu-card">
        <h2>下一輪交接</h2>
        ${batch.handoffDrafts.map((draft) => renderHandoffDraft(draft, batch)).join('') || '<p class="fushenglu-muted">沒有交接候選。</p>'}
      </section>
      <section class="fushenglu-management-only fushenglu-card">
        <h2>來源訊息</h2>
        <ul class="fushenglu-source-list">
          ${batch.inputMessages
            .map(
              (message) => `
                <li>
                  <strong>${escapeHtml(message.role)}</strong>
                  <span>${escapeHtml(message.messageRef)}</span>
                  <p>${escapeHtml(message.content)}</p>
                </li>
              `,
            )
            .join('') || '<li>自然語言修正沒有主聊天來源。</li>'}
        </ul>
      </section>
      <div class="fushenglu-sticky-action">${footer}</div>
    `;
  }

  function renderPending() {
    const screen = elements.screens.get('pending');
    const items = state?.pendingItems ?? [];
    screen.innerHTML = `
      <section class="fushenglu-section-heading">
        <div><p>保留歷史</p><h2>待確認</h2></div>
        <span class="fushenglu-badge">${items.filter((item) => item.status === 'pending').length}</span>
      </section>
      ${
        items
          .map(
            (item) => `
              <article class="fushenglu-card" data-pending-id="${escapeHtml(item.pendingId)}">
                <div class="fushenglu-change-head">
                  <h2>${escapeHtml(pendingLabel(item.kind))}</h2>
                  <span class="fushenglu-badge">${escapeHtml(item.status)}</span>
                </div>
                <textarea class="fushenglu-textarea" data-pending-edit>${escapeHtml(safeJson(item.proposal.value))}</textarea>
                <div class="fushenglu-actions fushenglu-actions-four">
                  <button type="button" data-action="resolve-pending" data-decision="accepted" data-pending-id="${escapeHtml(item.pendingId)}">同意</button>
                  <button type="button" data-action="resolve-pending" data-decision="rejected" data-pending-id="${escapeHtml(item.pendingId)}">拒絕</button>
                  <button type="button" data-action="resolve-pending" data-decision="edited" data-pending-id="${escapeHtml(item.pendingId)}">修改</button>
                  <button type="button" data-action="resolve-pending" data-decision="deferred" data-pending-id="${escapeHtml(item.pendingId)}">稍後</button>
                </div>
                <dl class="fushenglu-management-only fushenglu-meta">
                  <div><dt>來源批次</dt><dd>${escapeHtml(item.batchId)}</dd></div>
                  <div><dt>歷史筆數</dt><dd>${item.decisionHistory.length}</dd></div>
                </dl>
              </article>
            `,
          )
          .join('') || '<section class="fushenglu-empty"><h2>目前沒有待確認項目</h2></section>'
      }
    `;
  }

  function renderHandoff() {
    const screen = elements.screens.get('handoff');
    const items = state?.handoffItems ?? [];
    screen.innerHTML = `
      <section class="fushenglu-section-heading">
        <div><p>只含已確認內容</p><h2>主聊天交接</h2></div>
      </section>
      ${
        items
          .map(
            (item) => `
              <article class="fushenglu-card" data-handoff-id="${escapeHtml(item.handoffId)}">
                <label class="fushenglu-check">
                  <input type="checkbox" data-handoff-active ${item.active ? 'checked' : ''} />
                  <span>${item.active ? '正在提供' : '已停用'}</span>
                </label>
                <textarea class="fushenglu-textarea" data-handoff-text>${escapeHtml(item.text)}</textarea>
                <select data-handoff-mode>
                  <option value="until_changed" ${item.mode === 'until_changed' ? 'selected' : ''}>直到改變</option>
                  <option value="next_generation" ${item.mode === 'next_generation' ? 'selected' : ''}>只提供下一輪</option>
                  <option value="never" ${item.mode === 'never' ? 'selected' : ''}>不提供</option>
                </select>
                <button type="button" class="fushenglu-small-button" data-action="save-handoff" data-handoff-id="${escapeHtml(item.handoffId)}">儲存</button>
                <dl class="fushenglu-management-only fushenglu-meta">
                  <div><dt>來源事件</dt><dd>${escapeHtml(item.sourceEventIds.join('、') || '無')}</dd></div>
                  <div><dt>狀態類型</dt><dd>${escapeHtml(item.stateType)}</dd></div>
                  <div><dt>消耗時間</dt><dd>${escapeHtml(item.consumedAt ?? '尚未')}</dd></div>
                </dl>
              </article>
            `,
          )
          .join('') || '<section class="fushenglu-empty"><h2>尚無交接項目</h2></section>'
      }
    `;
  }

  function renderHistory() {
    const screen = elements.screens.get('history');
    const batches = [...(state?.batches ?? [])].reverse();
    const canUndo = batches.some(
      (batch) =>
        state.committedBatchIds.includes(batch.batchId) &&
        batch.revertedByBatchId === null &&
        batch.committedEventIds.length > 0,
    );
    screen.innerHTML = `
      <section class="fushenglu-section-heading">
        <div><p>事件與來源</p><h2>批次歷史</h2></div>
        <button type="button" data-action="undo-latest" ${canUndo ? '' : 'disabled'}>撤銷最近批次</button>
      </section>
      ${
        batches
          .map(
            (batch) => `
              <details class="fushenglu-history-item">
                <summary>
                  <span>${escapeHtml(new Date(batch.createdAt).toLocaleString('zh-Hant'))}</span>
                  <strong>${escapeHtml(statusLabel(batch.status))}</strong>
                </summary>
                <dl class="fushenglu-meta fushenglu-meta-visible">
                  <div><dt>batchId</dt><dd>${escapeHtml(batch.batchId)}</dd></div>
                  <div><dt>來源訊息</dt><dd>${escapeHtml(batch.sourceMessageRefs.join('、') || '無')}</dd></div>
                  <div><dt>接受</dt><dd>${escapeHtml(batch.acceptedProposalIds.join('、') || '無')}</dd></div>
                  <div><dt>拒絕</dt><dd>${escapeHtml(batch.rejectedProposalIds.join('、') || '無')}</dd></div>
                  <div><dt>交接</dt><dd>${state.handoffItems.filter((item) => item.batchId === batch.batchId).length}</dd></div>
                  <div><dt>撤銷</dt><dd>${escapeHtml(batch.revertedByBatchId ?? '否')}</dd></div>
                </dl>
              </details>
            `,
          )
          .join('') || '<section class="fushenglu-empty"><h2>尚無歷史</h2></section>'
      }
    `;
  }

  function fallbackApiSettings() {
    return {
      schemaVersion: 1,
      baseUrl: '',
      apiKey: '',
      analysisModel: '',
      generationModel: '',
      validationModel: '',
      temperature: 0.2,
      maxOutputTokens: 2048,
    };
  }

  function modelMenuMarkup() {
    if (loadedModels.length === 0) {
      return '<p class="fushenglu-model-menu-empty">尚未載入模型，仍可手動輸入。</p>';
    }

    return loadedModels
      .map(
        (model) => `
          <button type="button" class="fushenglu-model-option" data-action="choose-model" data-model="${escapeHtml(model)}" role="option">${escapeHtml(model)}</button>
        `,
      )
      .join('');
  }

  function renderModelCombo(name, label, value) {
    const menuId = `fushenglu-${name}-menu`;
    return `
      <label class="fushenglu-label">${label}
        <span class="fushenglu-model-combo">
          <input
            class="fushenglu-input"
            name="${name}"
            value="${escapeHtml(value)}"
            autocomplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-controls="${menuId}"
            aria-expanded="false"
          />
          <button type="button" class="fushenglu-model-picker" data-action="toggle-model-menu" data-model-field="${name}" aria-label="選擇${label}" aria-expanded="false">選擇</button>
          <span id="${menuId}" class="fushenglu-model-menu" data-model-menu="${name}" role="listbox" hidden>${modelMenuMarkup()}</span>
        </span>
      </label>
    `;
  }

  function renderApi() {
    const screen = elements.screens.get('api');
    let settings;
    let settingsError = null;

    try {
      settings = settingsStore.load();
    } catch (error) {
      settingsError = error instanceof Error ? error.message : String(error);
      settings = fallbackApiSettings();
    }

    screen.innerHTML = `
      <section class="fushenglu-section-heading">
        <div><p>與主聊天完全分離</p><h2>API 設定</h2></div>
      </section>
      ${settingsError ? `<aside class="fushenglu-notice" data-kind="error">${escapeHtml(settingsError)}</aside>` : ''}
      <form class="fushenglu-card fushenglu-api-form" data-api-form>
        <label class="fushenglu-label">API Base URL
          <input class="fushenglu-input" name="baseUrl" inputmode="url" value="${escapeHtml(settings.baseUrl)}" placeholder="https://api.example.com/v1" />
        </label>
        <label class="fushenglu-label">API Key
          <span class="fushenglu-key-row">
            <input class="fushenglu-input" name="apiKey" type="password" autocomplete="new-password" placeholder="${escapeHtml(maskApiKey(settings.apiKey) || '輸入新 Key')}" />
            <button type="button" data-action="toggle-key">顯示</button>
            <button type="button" data-action="clear-key">清除</button>
          </span>
        </label>
        <p class="fushenglu-help">已保存的 Key 不會放入 DOM；顯示按鈕只切換本次新輸入。</p>
        <div class="fushenglu-actions">
          <button type="button" data-action="load-models">載入模型</button>
        </div>
        ${renderModelCombo('analysisModel', '劇情分析模型', settings.analysisModel)}
        ${renderModelCombo('generationModel', '生成／問答模型', settings.generationModel)}
        ${renderModelCombo('validationModel', '校驗模型', settings.validationModel)}
        <div class="fushenglu-two-columns">
          <label class="fushenglu-label">Temperature
            <input class="fushenglu-input" name="temperature" type="number" min="0" max="2" step="0.05" value="${escapeHtml(settings.temperature)}" />
          </label>
          <label class="fushenglu-label">最大輸出 Tokens
            <input class="fushenglu-input" name="maxOutputTokens" type="number" min="1" max="131072" step="1" value="${escapeHtml(settings.maxOutputTokens)}" />
          </label>
        </div>
        <div class="fushenglu-actions">
          <button type="button" class="fushenglu-primary-button" data-action="save-api">儲存</button>
          <button type="button" data-action="test-api">測試連線</button>
        </div>
      </form>
    `;
  }

  function renderAll() {
    if (!state) {
      return;
    }

    renderHome();
    renderCharacterOverview();
    renderReview();
    renderPending();
    renderHandoff();
    renderHistory();
    renderApi();
    renderInventory();
    renderWardrobe();
    renderSkills();
    renderCultivation();
    showScreen(currentScreen);
  }

  async function refresh(successMessage = '已讀取目前聊天') {
    const capabilities = store.inspectCapabilities();

    if (!capabilities.ok) {
      state = null;
      chatId = null;
      setStatus(`缺少必要公開接口：${capabilities.missing.join('、')}`, 'error');
      return;
    }

    try {
      const result = await store.read();
      state = result.state;
      chatId = result.chatId;
      liveMessageCapability = normalizeChatMessages(result.messages);
      renderAll();
      const handoffNote = capabilities.handoff.ok
        ? ''
        : `；交接受限：${capabilities.handoff.missing.join('、')}`;
      setStatus(`${successMessage}${handoffNote}`, capabilities.handoff.ok ? 'success' : 'warning');
    } catch (error) {
      chatId = null;
      setStatus(
        error instanceof NoActiveChatError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error),
        'error',
      );
    }
  }

  async function runMutation(operation, successMessage) {
    if (busy) {
      return null;
    }

    setBusy(true);
    setStatus('處理中…');

    try {
      const result = await operation();
      await refresh(successMessage);
      return result;
    } catch (error) {
      try {
        await refresh('已保留目前進度');
      } catch {
        // 原錯誤仍是主要提示；下次開啟會再次從 metadata 恢復。
      }

      setStatus(error instanceof Error ? error.message : String(error), 'error');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveHistoryImportProgress(batchId, progress) {
    const timestamp = now();

    await store.update((current) => ({
      ...current,
      updatedAt: timestamp,
      batches: current.batches.map((item) =>
        item.batchId === batchId
          ? {
              ...item,
              historyImportProgress: {
                schemaVersion: 1,
                ...progress,
                updatedAt: timestamp,
              },
            }
          : item,
      ),
    }));
  }

  function historyImportProgressFor(batch, totalChunks) {
    const saved = batch.historyImportProgress;

    if (
      saved?.schemaVersion === 1 &&
      saved.totalChunks === totalChunks &&
      Number.isInteger(saved.nextChunkIndex) &&
      saved.nextChunkIndex >= 0 &&
      saved.nextChunkIndex <= totalChunks &&
      saved.mergedAnalysis
    ) {
      return {
        ...saved,
        mergedAnalysis: mergeAnalysisResults([
          saved.mergedAnalysis,
        ]),
      };
    }

    return {
      schemaVersion: 1,
      totalChunks,
      nextChunkIndex: 0,
      completedChunks: 0,
      failedChunkIndex: null,
      mergedAnalysis: createEmptyAnalysisResult(),
    };
  }

  async function analyzeHistoryImportBatch(batch) {
    const messages = batch.inputMessages.map(
      ({ messageRef, role, content }) => ({
        messageRef,
        role,
        content,
      }),
    );
    const chunks = splitAnalysisMessages(messages, {
      maxMessages: 8,
      maxCharacters: 9000,
    });

    if (chunks.length === 0) {
      throw new Error('目前聊天沒有可分析的 user／assistant 訊息。');
    }

    let progress = historyImportProgressFor(batch, chunks.length);
    let mergedAnalysis = progress.mergedAnalysis;

    for (
      let chunkIndex = progress.nextChunkIndex;
      chunkIndex < chunks.length;
      chunkIndex += 1
    ) {
      setStatus(
        `正在分段分析既有聊天：第 ${chunkIndex + 1}／${chunks.length} 段`,
        'neutral',
      );

      let partAnalysis;

      try {
        partAnalysis = await apiClient.analyzeMessages(
          chunks[chunkIndex],
          {
            batchId:
              `${batch.batchId}:part:${chunkIndex + 1}`,
          },
        );
      } catch (error) {
        await saveHistoryImportProgress(batch.batchId, {
          ...progress,
          totalChunks: chunks.length,
          nextChunkIndex: chunkIndex,
          completedChunks: chunkIndex,
          failedChunkIndex: chunkIndex,
          mergedAnalysis,
        });

        throw new Error(
          `既有聊天第 ${chunkIndex + 1}／${chunks.length} 段分析失敗：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      mergedAnalysis = mergeAnalysisResults([
        mergedAnalysis,
        partAnalysis,
      ]);
      progress = {
        schemaVersion: 1,
        totalChunks: chunks.length,
        nextChunkIndex: chunkIndex + 1,
        completedChunks: chunkIndex + 1,
        failedChunkIndex: null,
        mergedAnalysis,
      };

      await saveHistoryImportProgress(
        batch.batchId,
        progress,
      );
    }

    setStatus(
      `既有聊天 ${chunks.length} 段分析完成，正在建立合併預覽…`,
      'neutral',
    );

    return mergedAnalysis;
  }

  async function analyzeBatch(batchId, correction = false) {
    const snapshot = await store.read();
    const batch = getBatch(snapshot.state, batchId);

    if (!batch) {
      throw new Error('分析批次遺失');
    }

    try {
      const analysis = correction
        ? await apiClient.parseCorrection(batch.correctionText, { batchId })
        : batch.source === 'history_import'
          ? await analyzeHistoryImportBatch(batch)
          : await apiClient.analyzeMessages(
              batch.inputMessages.map(({ messageRef, role, content }) => ({
                messageRef,
                role,
                content,
              })),
              { batchId },
            );
      await store.update((current) =>
        completeBatchAnalysis(current, batchId, analysis, now()),
      );
    } catch (error) {
      await store.update((current) =>
        failBatch(current, batchId, 'analysis', error, now()),
      );
      throw error;
    }
  }

  async function endTurn() {
    const batchId = makeId('batch');
    await store.update((current, context) =>
      beginTurnBatch(current, context.messages, {
        batchId,
        timestamp: now(),
      }).state,
    );
    currentScreen = 'review';
    await analyzeBatch(batchId);
  }

  async function scanExistingChat() {
    const batchId = makeId('batch');
    await store.update((current, context) =>
      beginTurnBatch(current, context.messages, {
        batchId,
        timestamp: now(),
        source: 'history_import',
        forceAllMessages: true,
      }).state,
    );
    currentScreen = 'review';
    await analyzeBatch(batchId);
  }

  async function analyzeCorrection(text) {
    if (!text.trim()) {
      throw new Error('請先輸入修正內容');
    }

    const batchId = makeId('batch');
    await store.update((current) =>
      beginTurnBatch(current, [], {
        batchId,
        timestamp: now(),
        source: 'correction',
        correctionText: text.trim(),
      }).state,
    );
    currentScreen = 'review';
    await analyzeBatch(batchId, true);
  }

  async function queueCharacterOperation(kind, operation, value) {
    const batchId = makeId('batch');
    const action = createCharacterAction({
      actionId: makeId('action'),
      kind,
      operation,
      value,
      dedupeKey: `${kind}:${operation}:${JSON.stringify(value)}`,
      timestamp: now(),
    });

    await store.update((current) => {
      let next = addDraftAction(current, action, now());
      next = beginTurnBatch(next, [], {
        batchId,
        timestamp: now(),
        source: 'plugin_operation',
      }).state;
      return completeBatchAnalysis(next, batchId, createEmptyAnalysisResult(), now());
    });
    currentScreen = 'review';
  }

  async function finishCommit(batchId, startFromReview = true) {
    let beforeCommit = await store.read();
    let reviewBatch = getBatch(beforeCommit.state, batchId);

    if (reviewBatch?.status === 'review_ready') {
      const currentAnalysis = analysisResultFromBatch(reviewBatch);
      const incomplete = listIncompleteProposals(currentAnalysis);

      if (incomplete.length > 0) {
        setStatus(
          `正在依本聊天原文修復 ${incomplete.length} 筆不完整候選…`,
          'neutral',
        );
        const repaired = await apiClient.repairIncompleteAnalysis(
          currentAnalysis,
          reviewBatch.inputMessages.map(
            ({ messageRef, role, content }) => ({
              messageRef,
              role,
              content,
            }),
          ),
          {
            batchId: `${batchId}:precommit`,
            onProgress: ({
              groupIndex,
              totalGroups,
              completedCandidates,
              totalCandidates,
            }) => {
              if (groupIndex >= totalGroups) {
                setStatus(
                  `候選修復完成：${totalCandidates} 筆已檢查`,
                  'neutral',
                );
                return;
              }
              setStatus(
                `正在批次修復候選：第 ${groupIndex + 1}／${totalGroups} 組（已處理 ${completedCandidates}／${totalCandidates} 筆）`,
                'neutral',
              );
            },
          },
        );

        await store.update((current) =>
          refreshBatchAnalysis(
            current,
            batchId,
            repaired,
            now(),
          ),
        );
      }
    }

    if (startFromReview) {
      await store.update((current) => startBatchCommit(current, batchId, now()));
    }

    let snapshot = await store.read();
    let batch = getBatch(snapshot.state, batchId);

    if (batch.status === 'committing') {
      try {
        await store.update((current) =>
          commitBatch(current, batchId, { timestamp: now() }),
        );
      } catch (error) {
        await store.update((current) =>
          failBatch(current, batchId, 'commit', error, now()),
        );
        throw error;
      }
    }

    snapshot = await store.read();
    batch = getBatch(snapshot.state, batchId);

    if (batch.status === 'committed') {
      try {
        await store.update((current) =>
          prepareBatchHandoff(current, batchId, { timestamp: now() }),
        );
      } catch (error) {
        await store.update((current) =>
          failBatch(current, batchId, 'handoff', error, now()),
        );
        throw error;
      }
    }

    snapshot = await store.read();
    batch = getBatch(snapshot.state, batchId);

    if (batch.status === 'handoff_pending') {
      await store.update((current) => completeBatch(current, batchId, now()));
    }
  }

  async function resumeBatch(batchId) {
    let snapshot = await store.read();
    let batch = getBatch(snapshot.state, batchId);

    if (batch.status === 'failed') {
      await store.update((current) => retryBatch(current, batchId, now()));
      snapshot = await store.read();
      batch = getBatch(snapshot.state, batchId);
    }

    if (batch.status === 'analysis_pending') {
      return analyzeBatch(batchId, batch.source === 'correction');
    }

    return finishCommit(batchId, false);
  }

  function readApiField(form, name) {
    const field = form.querySelector(`[name="${name}"]`);

    if (!field) {
      throw new Error(`找不到 API 欄位：${name}`);
    }

    return String(field.value ?? '');
  }

  function readApiForm() {
    const form = root.querySelector('[data-api-form]');

    if (!form) {
      throw new Error('找不到 API 設定表單');
    }

    const existing = savedApiSettingsOrFallback();
    const newKey = readApiField(form, 'apiKey');
    return {
      ...existing,
      baseUrl: readApiField(form, 'baseUrl'),
      apiKey: newKey || existing.apiKey,
      analysisModel: readApiField(form, 'analysisModel'),
      generationModel: readApiField(form, 'generationModel'),
      validationModel: readApiField(form, 'validationModel'),
      temperature: Number(readApiField(form, 'temperature')),
      maxOutputTokens: readApiField(form, 'maxOutputTokens'),
    };
  }

  function readApiConnectionForm() {
    const form = root.querySelector('[data-api-form]');

    if (!form) {
      throw new Error('找不到 API 設定表單');
    }

    const existing = savedApiSettingsOrFallback();
    const newKey = readApiField(form, 'apiKey');
    return {
      baseUrl: readApiField(form, 'baseUrl'),
      apiKey: newKey || existing.apiKey,
    };
  }

  function savedApiSettingsOrFallback() {
    try {
      return settingsStore.load();
    } catch {
      return fallbackApiSettings();
    }
  }

  function updateModelMenus() {
    for (const menu of root.querySelectorAll('[data-model-menu]')) {
      menu.innerHTML = modelMenuMarkup();
    }
  }

  function closeModelMenus(exceptField = null) {
    for (const menu of root.querySelectorAll('[data-model-menu]')) {
      const field = menu.dataset.modelMenu;

      if (field === exceptField) {
        continue;
      }

      menu.hidden = true;
      root.querySelector(`[data-model-field="${field}"]`)?.setAttribute(
        'aria-expanded',
        'false',
      );
      root.querySelector(`[name="${field}"]`)?.setAttribute(
        'aria-expanded',
        'false',
      );
    }
  }

  function toggleModelMenu(field) {
    const menu = root.querySelector(`[data-model-menu="${field}"]`);
    const picker = root.querySelector(`[data-model-field="${field}"]`);
    const input = root.querySelector(`[name="${field}"]`);

    if (!menu || !picker || !input) {
      return;
    }

    const shouldOpen = menu.hidden;
    closeModelMenus(shouldOpen ? field : null);
    menu.hidden = !shouldOpen;
    picker.setAttribute('aria-expanded', String(shouldOpen));
    input.setAttribute('aria-expanded', String(shouldOpen));
  }

  function chooseModel(target) {
    const menu = target.closest('[data-model-menu]');
    const field = menu?.dataset.modelMenu;
    const input = field ? root.querySelector(`[name="${field}"]`) : null;

    if (!menu || !field || !input) {
      return;
    }

    input.value = target.dataset.model ?? '';
    closeModelMenus();
    input.focus({ preventScroll: true });
  }

  async function loadModelsFromForm() {
    if (busy) {
      return;
    }

    let connection;

    try {
      connection = readApiConnectionForm();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), 'error');
      return;
    }

    setBusy(true);
    setStatus('正在載入模型…');

    try {
      loadedModels = await apiClient.loadModels(connection);
      updateModelMenus();

      setStatus(
        loadedModels.length > 0
          ? `成功載入 ${loadedModels.length} 個模型`
          : '沒有找到模型，仍可手動輸入',
        loadedModels.length > 0 ? 'success' : 'warning',
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function saveApiForm({ testConnection = false } = {}) {
    if (busy) {
      return null;
    }

    let pendingSettings;

    try {
      pendingSettings = readApiForm();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), 'error');
      return null;
    }

    setBusy(true);
    setStatus(testConnection ? '正在測試連線…' : '正在儲存設定…');

    try {
      settingsStore.save(pendingSettings);
      const saved = settingsStore.load();
      const result = testConnection ? await apiClient.testConnection() : null;

      renderApi();
      showScreen('api');
      setStatus(
        testConnection ? `連線成功：${result.model}` : '插件 API 設定已儲存',
        'success',
      );
      return saved;
    } catch (error) {
      renderApi();
      showScreen('api');
      setStatus(error instanceof Error ? error.message : String(error), 'error');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function handleAction(action, target) {
    if (action === 'close') {
      setOpen(false);
      return;
    }

    if (action === 'toggle-mode') {
      const management = root.dataset.mode !== 'management';
      root.dataset.mode = management ? 'management' : 'immersive';
      elements.modeButton.textContent = management ? '沉浸' : '管理';
      elements.modeButton.setAttribute('aria-pressed', String(management));
      return;
    }

    if (action === 'open-screen') {
      showScreen(target.dataset.screen);
      return;
    }

    if (action === 'scan-existing-chat') {
      await runMutation(
        scanExistingChat,
        '既有聊天已建立變化預覽，請逐項核對後最後確認。',
      );
      return;
    }

    if (action === 'queue-currency') {
      const name =
        String(root.querySelector('[data-currency-name]')?.value ?? '').trim() ||
        '靈石';
      const amountText = String(
        root.querySelector('[data-currency-amount]')?.value ?? '',
      ).trim();
      const amount = Number(amountText);

      if (!amountText) {
        setStatus('請輸入貨幣數量。', 'error');
        return;
      }

      if (!Number.isFinite(amount) || amount < 0) {
        setStatus('貨幣數量必須是大於或等於零的數字。', 'error');
        return;
      }

      await runMutation(
        () =>
          queueCharacterOperation('currency', target.dataset.operation, {
            name,
            amount,
          }),
        '貨幣變化已加入本輪預覽，請最後確認。',
      );
      return;
    }

    if (action === 'queue-item') {
      await runMutation(
        () =>
          queueCharacterOperation('inventory', target.dataset.operation, {
            name: root.querySelector('[data-item-name]').value,
            quantity: Number(root.querySelector('[data-item-quantity]').value),
            category: root.querySelector('[data-item-category]').value,
            source: root.querySelector('[data-item-source]').value,
          }),
        '物品變化已加入本輪預覽，請最後確認。',
      );
      return;
    }

    if (action === 'queue-garment') {
      await runMutation(
        () =>
          queueCharacterOperation('wardrobe', 'add', {
            name: root.querySelector('[data-garment-name]').value,
            part: root.querySelector('[data-garment-part]').value,
            description: root.querySelector('[data-garment-description]').value,
            source: root.querySelector('[data-garment-source]').value,
            ownershipStatus: root.querySelector('[data-garment-ownership]').value,
          }),
        '衣物變化已加入本輪預覽；所有權不明會送往待確認。',
      );
      return;
    }

    if (action === 'queue-wear') {
      await runMutation(
        () =>
          queueCharacterOperation('wardrobe', 'wear', {
            name: root.querySelector('[data-outfit-name]').value,
            garments: root
              .querySelector('[data-outfit-garments]')
              .value.split(',')
              .map((item) => item.trim())
              .filter(Boolean),
          }),
        '換裝已加入本輪預覽，請最後確認。',
      );
      return;
    }

    if (action === 'queue-save-outfit') {
      await runMutation(
        () =>
          queueCharacterOperation('wardrobe', 'save_outfit', {
            name: root.querySelector('[data-outfit-name]').value,
            garments: root
              .querySelector('[data-outfit-garments]')
              .value.split(',')
              .map((item) => item.trim())
              .filter(Boolean),
          }),
        '穿搭保存已加入本輪預覽，請最後確認。',
      );
      return;
    }

    if (action === 'queue-skill') {
      await runMutation(
        () =>
          queueCharacterOperation('skill', target.dataset.operation, {
            name: root.querySelector('[data-skill-name]').value,
            category: root.querySelector('[data-skill-category]').value,
            proficiency: Number(root.querySelector('[data-skill-value]').value),
            sourceEvent: root.querySelector('[data-skill-source]').value,
          }),
        '技能變化已加入本輪預覽；新技能或重大變化會送往待確認。',
      );
      return;
    }

    if (action === 'queue-cultivation') {
      await runMutation(
        () =>
          queueCharacterOperation('cultivation', target.dataset.operation, {
            stage: root.querySelector('[data-cultivation-stage]').value,
            progressDescription: root.querySelector('[data-cultivation-progress]').value,
            milestoneName: root.querySelector('[data-cultivation-milestone]').value,
          }),
        '修煉變化已加入待確認，確認後才會正式生效。',
      );
      return;
    }

    if (action === 'add-test-action') {
      const input = root.querySelector('#fushenglu-test-action');
      await runMutation(
        () =>
          store.update((current) =>
            addDraftAction(current, createDraftTestAction(input.value), now()),
          ),
        '已暫存測試操作',
      );
      return;
    }

    if (action === 'end-turn') {
      await runMutation(endTurn, '分析完成，請最後確認');
      return;
    }

    if (action === 'analyze-correction') {
      const text = root.querySelector('#fushenglu-correction')?.value ?? '';
      await runMutation(() => analyzeCorrection(text), '修正已轉成修改預覽');
      return;
    }

    if (action === 'toggle-proposal') {
      await runMutation(
        () =>
          store.update((current) =>
            updateBatchProposal(
              current,
              target.dataset.batchId,
              target.dataset.proposalId,
              { reviewDisposition: target.checked ? 'apply' : 'reject' },
              now(),
            ),
          ),
        '已更新候選',
      );
      return;
    }

    if (action === 'proposal-disposition') {
      await runMutation(
        () =>
          store.update((current) =>
            updateBatchProposal(
              current,
              target.dataset.batchId,
              target.dataset.proposalId,
              { reviewDisposition: target.value },
              now(),
            ),
          ),
        '已更新候選去向',
      );
      return;
    }

    if (action === 'save-proposal') {
      const card = target.closest('[data-proposal]');
      await runMutation(
        () =>
          store.update((current) =>
            updateBatchProposal(
              current,
              target.dataset.batchId,
              target.dataset.proposalId,
              {
                operation: card.querySelector('[data-proposal-operation]').value,
                value: parseEditedValue(
                  card.querySelector('[data-proposal-value]').value,
                ),
              },
              now(),
            ),
          ),
        '已儲存候選修改',
      );
      return;
    }

    if (
      ['handoff-draft-active', 'handoff-draft-mode', 'save-handoff-draft'].includes(
        action,
      )
    ) {
      const card = target.closest('.fushenglu-change');
      const batchId = target.dataset.batchId;
      const draftId = target.dataset.draftId;
      const updates =
        action === 'handoff-draft-active'
          ? { active: target.checked }
          : action === 'handoff-draft-mode'
            ? { mode: target.value }
            : {
                text: card.querySelector('[data-handoff-draft-text]').value,
                mode: card.querySelector('[data-action="handoff-draft-mode"]').value,
                active: card.querySelector('[data-action="handoff-draft-active"]').checked,
              };
      await runMutation(
        () =>
          store.update((current) =>
            updateBatchHandoffDraft(current, batchId, draftId, updates, now()),
          ),
        '已儲存交接預覽',
      );
      return;
    }

    if (action === 'confirm-batch') {
      await runMutation(
        () => finishCommit(target.dataset.batchId),
        '批次已提交並完成交接準備',
      );
      return;
    }

    if (action === 'cancel-batch') {
      await runMutation(
        () =>
          store.update((current) =>
            cancelBatch(current, target.dataset.batchId, now()),
          ),
        '本輪已取消並保留歷史',
      );
      return;
    }

    if (action === 'certain-only') {
      await runMutation(async () => {
        await store.update((current) =>
          recoverCertainActionsOnly(current, target.dataset.batchId, now()),
        );
        await finishCommit(target.dataset.batchId);
      }, '只提交了插件內確定操作');
      return;
    }

    if (action === 'retry-batch' || action === 'resume-batch') {
      await runMutation(
        () => resumeBatch(target.dataset.batchId),
        '批次已安全續作',
      );
      return;
    }

    if (action === 'resolve-pending') {
      const card = target.closest('[data-pending-id]');
      const decision = target.dataset.decision;
      const editedProposal =
        decision === 'edited'
          ? {
              value: parseEditedValue(card.querySelector('[data-pending-edit]').value),
            }
          : null;
      await runMutation(
        () =>
          store.update((current) =>
            resolvePendingItem(current, target.dataset.pendingId, decision, {
              batchId: makeId('batch'),
              editedProposal,
              timestamp: now(),
            }),
          ),
        '待確認項目已處理並保留歷史',
      );
      return;
    }

    if (action === 'save-handoff') {
      const card = target.closest('[data-handoff-id]');
      await runMutation(
        () =>
          store.update((current) =>
            updateHandoffItem(
              current,
              target.dataset.handoffId,
              {
                text: card.querySelector('[data-handoff-text]').value,
                mode: card.querySelector('[data-handoff-mode]').value,
                active: card.querySelector('[data-handoff-active]').checked,
              },
              now(),
            ),
          ),
        '交接項目已更新',
      );
      return;
    }

    if (action === 'undo-latest') {
      await runMutation(
        () =>
          store.update((current) =>
            undoLatestCommittedBatch(current, {
              batchId: makeId('batch'),
              timestamp: now(),
            }),
          ),
        '最近批次已軟撤銷',
      );
      return;
    }

    if (action === 'toggle-key') {
      const input = root.querySelector('[name="apiKey"]');
      input.type = input.type === 'password' ? 'text' : 'password';
      target.textContent = input.type === 'password' ? '顯示' : '隱藏';
      return;
    }

    if (action === 'clear-key') {
      await runMutation(async () => {
        settingsStore.clearApiKey();
      }, 'API Key 已清除');
      return;
    }

    if (action === 'toggle-model-menu') {
      toggleModelMenu(target.dataset.modelField);
      return;
    }

    if (action === 'choose-model') {
      chooseModel(target);
      return;
    }

    if (action === 'save-api') {
      await saveApiForm();
      return;
    }

    if (action === 'load-models') {
      await loadModelsFromForm();
      return;
    }

    if (action === 'test-api') {
      await saveApiForm({ testConnection: true });
    }
  }

  function setOpen(open) {
    elements.fullscreen.hidden = !open;
    elements.entry.setAttribute('aria-expanded', String(open));
    documentRef.documentElement.classList.toggle('fushenglu-is-open', open);

    if (open) {
      lastFocusedElement = documentRef.activeElement;
      root.querySelector('[data-action="close"]').focus();
      void refresh('已重新讀取目前聊天');
    } else {
      const ElementClass = documentRef.defaultView?.HTMLElement;

      if (ElementClass && lastFocusedElement instanceof ElementClass) {
        lastFocusedElement.focus();
      }
    }
  }

  elements.entry.addEventListener('click', () => setOpen(true));
  root.addEventListener('click', (event) => {
    const nav = event.target.closest?.('[data-nav]');

    if (nav) {
      showScreen(nav.dataset.nav);
      return;
    }

    const target = event.target.closest?.('[data-action]');

    if (target) {
      if (
        [
          'toggle-proposal',
          'proposal-disposition',
          'handoff-draft-active',
          'handoff-draft-mode',
        ].includes(target.dataset.action)
      ) {
        return;
      }

      void handleAction(target.dataset.action, target);
    }
  });
  root.addEventListener('change', (event) => {
    const target = event.target.closest?.(
      '[data-action="toggle-proposal"], [data-action="proposal-disposition"], [data-action="handoff-draft-active"], [data-action="handoff-draft-mode"]',
    );

    if (target) {
      void handleAction(target.dataset.action, target);
    }
  });

  root.addEventListener('focusin', (event) => {
    const field = event.target.closest?.('input, textarea, select');

    if (!field || currentScreen !== 'api') {
      return;
    }

    const revealField = () => field.scrollIntoView({ block: 'nearest' });

    if (typeof globalThis.requestAnimationFrame === 'function') {
      globalThis.requestAnimationFrame(revealField);
    } else {
      revealField();
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
      state = null;
      chatId = null;
      liveMessageCapability = null;
      currentScreen = 'home';
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

