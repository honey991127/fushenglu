# Codex 分階段任務

## Task 0：倉庫檢查

只閱讀文件並輸出實作計畫，不修改程式。

完成條件：
- 說明產品與平台限制
- 列出需驗證的 TauriTavern API
- 提出正式目錄
- 列出 Task 1 檔案清單
- 指出規格衝突或缺失

## Task 1（第一階段）：規格修正、最小插件骨架與逐聊天儲存

這是一個單一任務，完成條件：

- 全部文件統一採用 `draft`、`analysis_pending`、`review_ready`、`committing`、`committed`、`handoff_pending`、`complete`、`failed`。
- 文件明定先暫存、後分析與預覽、玩家最後確認才原子提交。
- 建立純前端 third-party UI extension 的正式 manifest、入口、CSS 與建置設定。
- 只顯示「浮生錄」入口、手機全屏頁、目前聊天識別與儲存測試狀態。
- 只使用公開宿主接口並進行 capability detection，不依賴私有 DOM 或 Node server plugin。
- 實作 `ChatState` 的 `schemaVersion`、讀寫、最小遷移、清空與逐聊天隔離。
- 補充並通過單元／整合測試及建置檢查。
- 不實作任何遊戲模組。

## Task 2：API 設定與測試

API 地址、Key、三個模型槽位、錯誤處理和 Key 遮蔽。

## Task 3：本輪偵測、批次預覽與交接原型

新增聊天偵測、本輪暫存、`batchId`、分析、變化預覽、最後確認、交接注入與 Swipe 防重複。必須遵守第一階段確立的狀態機；帳本提交先以最小測試帳本驗證冪等性。

## Task 4：待確認、自然語言修正與事件歷史

## Task 5：帳本、物品與衣櫥

## Task 6：技能、修煉、作業與考核

## Task 7：每日／每週商店

## Task 8：書信與問答

## Task 9：期間活動、榜冊與評價

## Task 10：人物、地點與柏寶書唯讀適配
