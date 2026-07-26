# fushenglu（浮生錄）

fushenglu 是面向 iPhone TauriTavern / SillyTavern 的前端擴充。主聊天 AI 與插件 AI 完全分離；插件使用自訂 OpenAI-compatible API。

## 目前狀態

這是 Codex 開發起始包，不是可安裝版本。

- `mockups/ui-v13.html`：介面與流程參考
- `docs/PRD.md`：產品需求
- `docs/ARCHITECTURE.md`：技術架構
- `docs/DATA_MODEL.md`：核心資料模型
- `docs/ACCEPTANCE_TESTS.md`：驗收條件
- `docs/CODEX_TASKS.md`：分階段任務
- `AGENTS.md`：Codex 必須遵守的規則

## 第一個目標

只做技術原型，驗證：

1. TauriTavern 能載入擴充 UI。
2. 每段聊天可保存獨立資料。
3. 能取得每輪新增聊天。
4. 能在下一輪生成前加入交接資訊。
5. iPhone WebView 能呼叫外部 OpenAI-compatible API。

第一階段不得實作完整商店、技能、活動、排名或書信。
