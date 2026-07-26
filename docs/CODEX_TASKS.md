# Codex 分階段任務

## Task 0：倉庫檢查

只閱讀文件並輸出實作計畫，不修改程式。

完成條件：

- 說明產品與平台限制。
- 列出需驗證的 TauriTavern API。
- 提出正式目錄。
- 列出 Task 1 檔案清單。
- 指出規格衝突或缺失。

## Task 1（第一階段）：規格修正、最小插件骨架與逐聊天儲存

完成條件：

- 文件統一採用完整批次狀態機。
- 建立純前端 third-party UI extension 骨架。
- 建立手機全屏頁、聊天識別、公開接口偵測。
- 實作 `ChatState` V1、遷移、清空與逐聊天隔離。
- 不實作任何遊戲模組。

## Task 2（第二階段）：獨立 API、每輪同步核心、待確認與交接

這是單一核心任務，合併原先拆列的 API、同步／交接、待確認／歷史原型，
避免在尚未形成可驗證閉環前開始任何玩法模組。

完成條件：

- 插件自有 OpenAI-compatible API 設定、三模型槽位、Key 遮蔽／清除與連線測試。
- structured output 不支援時仍須完整 JSON 解析、本地 Schema 驗證及全有或全無拒絕。
- `ChatState` V2、逐聊天訊息邊界、穩定 ID／Swipe ID 優先與指紋降級提示。
- 唯一 `batchId` 與 `draft`、`analysis_pending`、`review_ready`、`committing`、
  `committed`、`handoff_pending`、`complete`、`failed` 全狀態。
- 本輪暫存、分析、變化預覽、最後確認、冪等提交、同批重試與重開續作。
- 劇情候選 Schema、待確認、自然語言修正預覽、最小事件歷史與軟撤銷。
- `HandoffItem` 的 `until_changed`、`next_generation`、`never` 及最小生成前注入。
- 只用通用測試操作與測試狀態驗證提交；不得建立正式玩法資料表或規則。
- 手機首頁、本輪、待確認、交接、歷史、API 頁面與預設沉浸模式。
- 測試與建置通過，建置物不含 Node-only runtime import。

## Task 3（第三階段）：帳本、貨幣、物品與衣櫥

待第二階段實機接口驗證完成後才可開始：

- 正式多貨幣帳本與物品庫。
- 衣物所有權、穿著狀態與換裝。
- 交易原子性、庫存與業務級撤銷。

不得在 Task 2 預建商店輪替、衣櫥玩法或正式資產規則。

## Task 4：技能、修煉、作業與考核

## Task 5：每日／每週商店

## Task 6：書信與問答

## Task 7：期間活動、榜冊與評價

## Task 8：人物、地點與柏寶書唯讀適配
