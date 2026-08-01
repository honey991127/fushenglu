# 浮生錄 0.5.0 PRD 摘要

## 產品邊界

- iPhone TauriTavern／SillyTavern 的純前端 extension；不使用 Node-only server plugin。
- 插件分析 API 與主聊天 AI 分離。API Key 是全域插件設定，不會寫入 ChatState、普通 DOM、diagnostics 或 export。
- 每段聊天的 ChatState V5、事件帳本、snapshot、world rules、handoff 與歷史進度皆完全隔離。

## 正式資料流程

AI 只提出 model-like candidates。正式流程為 schema validation → candidate normalization → local semantic policy → review/pending → committed event ledger → deterministic currentSnapshot → canonical handoff → metadata save → host prompt。

模型不得決定 event id、fact key、最終 disposition、owner 缺失時的歸屬或正式帳本寫入。owner 缺失不能預設為玩家，quantity 缺失不能補為 1。pending、rejected、deferred、非 main timeline 與 NPC 資產不得進 snapshot 或 handoff。

## 體驗

- 預設每輪總確認；`auto_commit_safe` 僅自動提交 policy `apply`，pending 永遠由使用者決定。
- 首頁顯示 currentSnapshot 的時間、地點、玩家資產、貨幣、人物與關係；普通 UI 不提供 raw JSON 編輯。
- 世界規則分為 suggestion 與 confirmed；貨幣 unit/tier 不在沒有 confirmed rule 時自動換算或合併。
- 歷史掃描使用 chunk 與 rolling context，唯一進度為 V5 根層 `historyImportProgress`。
- 可重置目前聊天的分析資料；API settings 保留，world rules 可選保留。

## 發行守則

唯一可編輯 runtime 是 `src/`。build 由 manifest/package 共同版本產生帶 hash 的 browser runtime closure；不得人工維護版本化 source 或 `v042` runtime。每次發行必須通過 `npm run verify` 與 iPhone 實機清單。
