# 技術架構

## 平台與執行邊界

- iPhone TauriTavern／相容 SillyTavern third-party UI extension。
- 純瀏覽器 ES module、DOM、`fetch` 與公開宿主 context。
- Node.js 只用於語法檢查、測試與複製建置，不進入執行時。
- 插件 OpenAI-compatible API 與主聊天 AI 連線完全分離。
- 逐聊天狀態只放 `chatMetadata["fushenglu.chatState"]`。
- API 設定放插件自己的瀏覽器設定儲存；不放逐聊天資料與匯出。

## 第二階段正式目錄

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
    analysis-schema.js
    api-client.js
    turn-sync.js
  integrations/
    tauritavern.js
  ui/
    app.js
tests/
```

`mockups/ui-v13.html` 仍只供視覺與流程參考。正式 UI 是多頁殼層，不載入或複製 mockup
單頁程式。

## 核心分層

- `chat-state.js`：ChatState V2、V0／V1 遷移、完整根狀態驗證、安全匯出。
- `analysis-schema.js`：分析 JSON Schema、JSON fence 降級解析、全有或全無驗證。
- `api-client.js`：插件獨立設定、Key 遮蔽／日誌清理、chat completions、structured-output
  降級及可選校驗模型。
- `turn-sync.js`：訊息邊界、批次狀態機、預覽、待確認、交接、歷史及最小軟撤銷。
- `tauritavern.js`：公開 context capability detection、逐聊天 metadata 原子保存及生成事件橋。
- `app.js`：手機首頁、本輪、待確認、交接、歷史與 API 頁面。

## 資料流

```text
插件測試操作 ──> ChatState.draftActions
                         |
主聊天 user/assistant ──> 訊息槽去重 ──> 結束本輪
                                          |
                                          v
               draft -> analysis_pending -> OpenAI-compatible API
                                          -> JSON 解析 + 本地 Schema
                                          -> 可選校驗模型
                                          -> review_ready
                                          -> 玩家修改／勾選／移待確認
                                          -> committing
                                          -> 原子寫入事件 + batchId
                                          -> committed
                                          -> handoff_pending
                                          -> complete
```

API、解析或保存錯誤寫為 `failed` 並保留原 `batchId`、輸入、分析進度與 `failurePhase`。
重試依階段回到 `analysis_pending`、`committing` 或 `handoff_pending`。

## 訊息邊界

1. 優先讀取訊息物件的穩定 ID。
2. 穩定 ID 缺失時，用 role、send date 與名稱建立可重現的訊息槽指紋。
3. 連時間戳也缺失時才用陣列位置，並在 UI 顯示限制。
4. Swipe ID 與內容指紋保存在證據引用，但不改變訊息槽 ID。
5. 成功完成批次才加入 `processedSlotKeys` 並更新 `lastSuccessfulIndex`。
6. 玩家取消未提交批次時加入 `ignoredSlotKeys`，避免同一取消內容反覆分析。

這個設計刻意不把編輯或替代 Swipe 當新取得的遊戲結果。無穩定 ID 的宿主仍可能在刪除、
跨裝置匯入或整段重排後失去訊息槽一致性，因此必須保留 UI 警告。

## API 安全

- 設定頁載入時不把已保存 API Key 放入 DOM，只顯示尾碼遮蔽 placeholder。
- 顯示／隱藏只控制本次新輸入值。
- 匯出設定省略 `apiKey`；ChatState 本身不保存 API 設定。
- 安全 logger 會清除 `apiKey`、Authorization、token 欄位與已知秘密字串。
- 未支援 `response_format: json_schema` 的端點只在明確 400／404／422 相容性錯誤時，
  用相同批次改送普通 JSON 請求；結果仍須本地 Schema 全量通過。
- 分析模型不取得完整插件資料庫，只取得本批新增訊息引用與內容。

## 宿主公開接口

必要核心：

- `SillyTavern.getContext()`
- `getCurrentChatId()` 或 `chatId`
- `chat`
- `chatMetadata`
- `saveMetadata()`
- `eventSource.on`
- `eventTypes.CHAT_CHANGED`

最小交接另外需要：

- `setExtensionPrompt()`
- `saveChat()`
- `GENERATION_AFTER_COMMANDS`（可降級到 `GENERATION_STARTED`）
- `MESSAGE_RECEIVED`
- 可選 `GENERATION_STOPPED`

交接以 `IN_CHAT`、depth 0、system role 注入一段一致性提示。`MESSAGE_RECEIVED` 不是
「已保存」事件，因此橋接器在接收後顯式呼叫 `saveChat()`；只有該 Promise 成功才消耗
`next_generation`。

## 已知接口限制

- 官方公開事件沒有獨立的「assistant 回覆已成功持久化」事件。顯式 `saveChat()` 是目前最小
  可驗證替代；TauriTavern 若裁剪此方法，交接可注入但不會自動消耗。
- 標準 SillyTavern 訊息通常以陣列位置作顯示 ID，未保證跨編輯穩定 UUID。
- iOS WKWebView 對第三方 API 的 CORS、TLS 與本機網路權限由 TauriTavern 封裝決定。
- metadata 保存不是宿主提供的資料庫交易；本插件以完整物件替換、失敗回復及 `batchId`
  冪等集合提供單 metadata 範圍的原子性。
