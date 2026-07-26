# 驗收測試

## 第二階段：獨立 API

- API 設定包含 Base URL、Key、三模型槽位、Temperature 與最大輸出 Tokens。
- 三個模型槽位可填同一模型。
- 重新打開設定頁只顯示 API Key 遮蔽尾碼，不把已保存 Key 放入 input value。
- 顯示／隱藏只作用於本次新輸入；清除 Key 後連線不再帶 Authorization。
- 匯出設定與逐聊天匯出都沒有完整 API Key；日誌沒有完整 Key。
- 測試連線使用插件設定，不讀取或修改主聊天連線。
- 支援標準 `/chat/completions`。
- structured output 不支援時可降級，但普通 JSON 仍須本地 Schema 完整通過。
- API、HTTP、JSON 或 Schema 失敗後，原聊天狀態和原批次輸入仍存在。

## 每輪邊界

- 記錄 `lastSuccessfulIndex`、已處理訊息槽與忽略訊息槽。
- 只抽取未處理的 user／assistant；system 訊息不進分析。
- 穩定 message ID 優先，Swipe ID 與內容指紋保留在證據引用。
- 同一訊息編輯、刪除後重排或 Swipe 替代不得重複套用已提交變化。
- 無穩定 ID 時顯示指紋或位置降級限制。
- `timelineContext` 為 memory、quote、dream、unknown 的時間候選預設進待確認。
- 沒有插件操作時仍可按「結束本輪」。
- 聊天切換後 UI 重新取得 context，不沿用舊 metadata 參照。

## 批次狀態與失敗

- 合法狀態只有 `draft`、`analysis_pending`、`review_ready`、`committing`、`committed`、
  `handoff_pending`、`complete`、`failed`。
- 按「結束本輪」建立一次唯一 `batchId`；App 重開與重試沿用該值。
- `analysis_pending` 前只凍結測試操作和訊息，不改正式測試狀態。
- `review_ready` 可勾選、取消、編輯或移待確認，仍未正式寫入。
- 最後確認才進 `committing`；同一 `batchId` 重複提交只有一份事件和記錄。
- 提交成功後依次記錄 `committed`、`handoff_pending`、`complete`。
- 失敗保留 `failurePhase`、錯誤摘要、輸入與進度。
- 分析失敗提供同批重新分析、只提交確定測試操作及取消本輪。
- App 重開可顯示並續作 `analysis_pending`、`review_ready`、`committing`、
  `committed`、`handoff_pending` 或 `failed` 批次。

## 分析與預覽

- 分析包含九類 changes、`uncertainItems` 與 `evidence`。
- 每個候選包含 proposalId、kind、operation、value、confidence、證據引用、reason、
  severity、dedupeKey。
- 明確、minor 且 confidence 至少 0.8 的候選預設勾選。
- 人物、地點、重大／關鍵變化、新技能／突破、非主線時間與低信心候選預設待確認。
- 任一候選 Schema 不合法時整份分析失敗，沒有部分套用。
- 沉浸模式隱藏信心、理由、去重鍵和來源；管理模式顯示。
- 預覽同時顯示暫存操作、聊天候選、不確定事項與交接草稿。

## 待確認與修正

- 待確認頁支援故事時間、貨幣與物品、衣物所有權、人物、地點、技能、修煉、評價、
  資料衝突與其他。
- 同意、拒絕、修改、稍後處理都新增 decision history，不永久刪除項目。
- 拒絕與稍後處理不新增正式測試記錄。
- 自然語言修正先呼叫生成／問答模型形成 `review_ready` 修改預覽。
- 玩家最後確認前，修正不得建立正式事件或修改測試狀態。

## 主聊天交接

- 交接頁可編輯文字、停用、改模式與查看來源事件。
- 注入只含已確認的 `HandoffItem`；不含待確認、分析理由、問答助手或完整資料庫。
- 注入提示主聊天保持一致，不要求主動重述已完成操作。
- `next_generation` 在生成失敗、取消、Swipe 或重抽時不消耗。
- `next_generation` 只有 assistant 回覆成功 `saveChat()` 後消耗。
- `until_changed` 被同 `stateType` 新項目取代。
- `never` 不注入。

## 歷史與撤銷

- 批次詳情顯示時間、狀態、來源訊息、接受／拒絕候選與交接數量。
- 撤銷最近一個有正式測試事件的批次。
- 事件、測試記錄與該批交接採 `deletedAt` 軟刪除。
- 原批次保存 `revertedByBatchId`，撤銷本身也有唯一 `batchId`。
- 第二階段不測試正式貨幣、庫存、衣櫥或複雜業務級聯。

## 手機與建置

- 預設沉浸模式；可切到管理模式。
- 首頁、本輪、待確認、交接、歷史、API 頁面可在 iPhone 寬度操作。
- header、底部 nav 與內容使用 safe area。
- 內容底部 padding 足以避開固定 nav；sticky 確認按鈕不遮住最後一項。
- input 使用 16px，鍵盤彈出時內容仍可捲動到目前欄位。
- `npm run verify` 通過。
- 正式 `src/` JavaScript 建置清單完整且不含 `node:`、`require()` 或 `process.env`。
- 第三階段前不得出現正式商店、技能、修煉、衣櫥、書信、活動、排名或評價玩法。
