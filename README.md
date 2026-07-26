# fushenglu（浮生錄）

面向 iPhone TauriTavern／相容 SillyTavern 的純前端擴充。主聊天 AI 與插件 AI 完全分離；
插件使用自己的 OpenAI-compatible chat completions 設定。

## 目前狀態：第二階段

已完成：

- 手機全屏首頁、本輪預覽、待確認、交接、歷史與 API 設定。
- ChatState V2 逐聊天隔離與 V0／V1 遷移。
- 插件獨立 Base URL、API Key、三模型槽位、Temperature、Tokens 與連線測試。
- Key 遮蔽／清除、安全日誌與不含 Key 的匯出。
- user／assistant 每輪訊息邊界、穩定 ID／Swipe ID 優先及指紋降級。
- 完整批次狀態機、同 `batchId` 重試、冪等提交與 App 重開續作。
- 劇情候選 JSON Schema、structured-output 降級、全量本地驗證與可選校驗模型。
- 本輪變化預覽、待確認、自然語言修正預覽。
- `until_changed`、`next_generation`、`never` 交接及最小生成前注入。
- 批次歷史與最近批次軟撤銷。

本階段只用「測試操作」及通用測試狀態驗證提交核心。尚未建立正式商店、貨幣、物品、
衣櫥、技能、修煉、書信、活動、排名、評價、人物或地點玩法。

## 執行環境

- 執行時：iPhone TauriTavern 或相容 SillyTavern UI extension。
- 開發與建置：Node.js 20 或以上。
- 執行時沒有 Node server plugin，也不呼叫本專案後端。
- 外部 API 必須允許 TauriTavern WebView 直接 `fetch`；Base URL 通常應包含 `/v1`。

## 測試與建置

```bash
npm run verify
```

也可分開執行：

```bash
npm run check
npm test
npm run build
```

建置結果在 `dist/fushenglu/`。正式 runtime JavaScript 不包含 Node-only import。

## 安裝與更新

### Git URL

1. 將倉庫推送到 TauriTavern 可存取的 Git URL。
2. 在 Extensions／擴充功能選擇安裝第三方擴充。
3. 貼上 Git URL，安裝並啟用「浮生錄」。
4. 重新載入 TauriTavern。

更新時在擴充管理頁對同一擴充執行 Update／更新，再重新載入。`manifest.json` 版本為
`0.2.0`；更新後第一次開啟各聊天會自動把 V1 遷移為 V2。

### 手動建置

1. 在電腦執行 `npm run build`。
2. 用完整 `dist/fushenglu/` 取代宿主第三方 UI extension 目錄中的舊 `fushenglu`。
3. 確認 `manifest.json`、`README.md` 與整個 `src/` 都一起更新。
4. 完全重新載入 TauriTavern；不要只替換單一 JavaScript。

實際目錄與更新按鈕名稱依 TauriTavern 版本而異，以該版本擴充管理頁為準。

## 使用流程

1. 開啟一段聊天，點右下「浮生錄」。
2. 到「API」輸入插件自己的 Base URL、Key 與模型，儲存後測試連線。
3. 回首頁；可暫存簡單測試操作，也可不操作。
4. 按「結束本輪」。
5. 在「本輪」勾選、修改或移動候選，編輯交接後最後確認。
6. 在「待確認」處理重大／不確定候選。
7. 在「交接」調整已確認內容；在「歷史」查看或軟撤銷最近批次。

「管理」模式顯示 confidence、reason、dedupeKey、證據和來源訊息；預設沉浸模式隱藏這些
管理資訊。

## API Key 與資料

- 已保存 Key 不會重新放入設定 input，只顯示遮蔽尾碼。
- 顯示／隱藏只作用於本次新輸入。
- API 設定不在 `ChatState`，不沿用主聊天 API。
- 聊天匯出和 API 設定匯出都不包含 Key。
- 每段聊天的批次、事件、待確認與交接只存在該聊天 metadata。
- 插件分析只送出本批新增訊息，不送完整插件資料庫。

## 已知 TauriTavern 接口限制

- SillyTavern 公開 context 有 `MESSAGE_RECEIVED`，但沒有獨立的「assistant 回覆已持久化」
  事件。插件收到回覆後顯式等待 `saveChat()` 成功，再消耗 `next_generation`。
- 如果 TauriTavern 沒公開 `setExtensionPrompt` 或 `saveChat`，核心同步仍可用，但 UI 會
  顯示交接能力受限。
- 宿主未提供穩定 message ID 時會改用時間戳指紋；再缺時間戳才用陣列位置並警告。
- iOS WebView 的 CORS、TLS 憑證、本機網路存取和背景執行由 TauriTavern 決定。
- metadata 提供單物件保存，沒有資料庫交易 API；插件用物件替換、失敗回復與 `batchId`
  防重複。

## iPhone 實機檢查順序

1. 安裝／更新與重新載入。
2. API Key 遮蔽、顯示新輸入、清除及測試連線。
3. 無操作結束本輪、正常分析、修改與最後提交。
4. 斷網／無效 JSON後同批重試、只提交確定操作、取消。
5. 單聊、群聊與聊天切換的資料隔離。
6. 編輯、刪除、Swipe、重抽後不重複套用。
7. App 強制關閉再開後恢復未完成批次。
8. `next_generation` 在正常保存、停止、失敗、Swipe 時的消耗差異。
9. `until_changed` 取代與交接來源事件。
10. safe area、底部 nav、長預覽捲動、鍵盤、旋轉與動態視窗高度。
