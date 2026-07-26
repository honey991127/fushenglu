# 技術架構

## 平台

- iPhone TauriTavern
- SillyTavern third-party UI extension 形式的純前端擴充
- 外部 OpenAI-compatible API
- Node.js 只用於開發、測試與建置
- 執行時不依賴 Node-only server plugin

## 第一階段正式目錄

```text
manifest.json
build.config.mjs
scripts/
  build.mjs
src/
  index.js
  style.css
  core/
    chat-state.js
  integrations/
    tauritavern.js
  ui/
    app.js
tests/
```

後續模組只能按 `CODEX_TASKS.md` 逐階段加入，不在第一階段預建玩法程式。

## 宿主接口邊界

- 只從公開的 `globalThis.SillyTavern.getContext()` 取得宿主能力。
- 逐聊天資料只放在當前 context 的 `chatMetadata`，並以 `saveMetadata()` 持久化。
- 以公開 `CHAT_CHANGED` 事件重新讀取畫面；每次操作都重新取得 context，不保存長期 `chatMetadata` 參照。
- 入口與全屏頁只建立和管理插件自己的 DOM 節點，不查找或依賴 TauriTavern／SillyTavern 私有 DOM 結構。
- 啟動時進行 capability detection。缺少聊天識別、`chatMetadata`、`saveMetadata()` 或聊天切換事件時，顯示錯誤並停用儲存操作。

## 後續目錄方向

```text
src/
  core/
    lifecycle/
    storage/
    events/
    schema/
    api/
    handoff/
  modules/
    ledger/
    wardrobe/
    skills/
    cultivation/
    shops/
    activities/
    rankings/
    evaluations/
    correspondence/
    world-library/
    assistant/
  integrations/
    tauritavern/
    baibai-book/
  ui/
    shell/
    screens/
    components/
```

## 資料流

```text
插件操作 -> 逐聊天本輪暫存
             |
             +-- 結束本輪 -> 建立 batchId -> 聊天分析 -> Schema 驗證
                                      -> deterministic rules
                                      -> review_ready 預覽
                                      -> 玩家最後確認
                                      -> 原子帳本提交
                                      -> 交接準備 -> 下一輪生成
```

## 批次狀態機

```text
draft -> analysis_pending -> review_ready -> committing -> committed
                                                    |          |
                                                    |          +-> handoff_pending -> complete
                                                    +-----------------------------> complete

analysis_pending / committing / handoff_pending -> failed
failed -> 原失敗階段重試，或在尚未提交時回到 review_ready／取消為 complete
```

- `draft`：已建立 `batchId` 並凍結本輪暫存操作。
- `analysis_pending`：分析中或等待用相同 `batchId` 重試。
- `review_ready`：預覽已完成，等待玩家最後確認；正式帳本未變更。
- `committing`：以 `batchId` 執行原子提交。
- `committed`：帳本已成功且只成功一次。
- `handoff_pending`：等待建立或注入主聊天交接。
- `complete`：批次已完成，或未提交內容已明確取消。
- `failed`：保存 `failurePhase` 與錯誤摘要，以決定安全重試位置。

## 原子提交與防重複

- 正式帳本交易與 `batchId` 提交紀錄必須在同一原子操作中完成。
- `batchId` 是提交冪等鍵；同一 `batchId` 的再次提交只回傳既有結果，不重做副作用。
- 分析失敗時，暫存操作仍未進正式帳本。玩家可重試分析、只提交確定操作或取消。
- 提交失敗時只能用相同 `batchId` 恢復；不得生成新批次來重放同一操作。
- 交接失敗不得回滾已提交帳本，也不得再次執行交易。
- 保存 `sourceMessageId`、`sourceEventId`、`dedupeKey`、`anchorSwipeId` 與 `branchFingerprint`，避免主聊天重述、Swipe、App 重開或重複點擊造成重複效果。

## 逐聊天儲存

- `ChatState` 保存於每段聊天自己的 metadata 命名空間。
- 每個保存物件都包含 `schemaVersion`。
- 讀取時執行逐版本遷移；遇到未知未來版本或損壞資料時停止覆寫並顯示錯誤。
- 不使用全域 localStorage 作為逐聊天資料來源。

## API 與柏寶書

- API Key 不進匯出、不進日誌。
- API 設定與主聊天連接分離。
- 柏寶書為可選唯讀來源。
- 新插件是交易、衣櫥、技能、活動、排名、評價和書信的權威來源。
