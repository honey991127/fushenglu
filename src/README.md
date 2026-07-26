# 原始碼

- `index.js`：建立逐聊天 store、插件 API client、交接 bridge 與 UI。
- `style.css`：iPhone 優先的全屏多頁殼層、safe area、鍵盤捲動與沉浸／管理模式。
- `core/chat-state.js`：ChatState V2、V0／V1 遷移、嚴格驗證與安全匯出。
- `core/analysis-schema.js`：候選結果 JSON Schema、JSON 解析與全量驗證。
- `core/api-client.js`：插件獨立 API 設定、Key 安全及 OpenAI-compatible chat completions。
- `core/turn-sync.js`：訊息邊界、批次、預覽、待確認、交接、歷史與最小撤銷。
- `integrations/tauritavern.js`：公開宿主接口、metadata 保存與生成前交接。
- `ui/app.js`：首頁、本輪、待確認、交接、歷史與 API 設定頁。

正式 runtime 只使用瀏覽器能力與 `SillyTavern.getContext()`；不得加入 `node:` import、
`require()`、`process.env` 或 Node-only server plugin。

第二階段的事件和 `testState` 是同步核心測試資料，不是正式玩法模組。候選 Schema 雖包含
衣物、技能、修煉、人物、地點與評價種類，本目錄沒有實作其業務規則或正式資料庫。
