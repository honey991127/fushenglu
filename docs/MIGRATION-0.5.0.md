# Migration 至 0.5.0

0.5.0 以 ChatState V5 為正式資料格式。載入 V4 時會建立 world rules、entities、relationships、event ledger、current snapshot、pending decision records、handoff items 與唯一的 history import progress 根欄位。

遷移是保守的：缺失 inventory owner 不會預設為玩家；污染、無法驗證或未知未來版本不會被自動修復或覆寫。使用者可在設定中重置目前聊天的浮生錄資料，API settings 一律保留，world rules 可選擇保留。

0.5.0 的 runtime 不再維護 `.v042.js` 或其他人工版本化 source。build 依 manifest 版本生成 cache-safe hashed runtime 與 dist manifest。升版時只更新 manifest/package/lockfile 的版本，然後執行 build。
