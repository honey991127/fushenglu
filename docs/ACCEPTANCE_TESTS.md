# 0.5.0 驗收測試

執行 `npm run verify`。它必須完成 syntax check、build 與 Node test，且沒有 failed tests。

自動驗收覆蓋：

- manifest/package semver 一致、dist manifest 載入完整 hash runtime closure、runtime 無 Node-only import。
- V4 → V5 安全 migration、未知未來版本停止覆寫，以及 reset 清除範圍。
- schema、normalizer、semantic policy、factKey 與 eventId 的本地決策；缺 owner 或 quantity 不會猜玩家或 1。
- 日期／時辰 consolidation、chunk rolling context、進度失效、每批最多一次 repair。
- event ledger reducer：資產、貨幣、人物持續／即時狀態、單向關係、軟刪除與 deterministic rebuild。
- happy-dom 掛載的確認、reset、確認模式和每頁 20 筆 pending UI。
- canonical snapshot handoff、CHAT_CHANGED 隔離與 `next_generation` 僅於 assistant save 成功後消耗。

發行前亦應以 `rg` 檢查：不存在 `*.v042.js`、runtime filename 的 `v042`、普通 UI raw JSON textarea、玩家 owner／quantity 猜測、proposal/review/draft 正式 handoff 路徑、舊 history progress 雙寫、happy-dom runtime import 或被追蹤的 `node_modules`。
