# Runtime source

`src/` 是唯一可編輯的 browser ES module source。build 會以 manifest 的 0.5.0 版本替換 `version.js` placeholder，產生帶內容 hash 的 dist runtime closure。

核心資料為每聊天 ChatState V5；AI 輸出需經 schema、normalizer 與本地 semantic policy，正式資料由 event ledger rebuild 成 currentSnapshot。canonical host handoff 只讀取已保存的 snapshot sections。

不得在 runtime 加入 `node:` import、`require()`、`process.env`、happy-dom 或手工版本化 `.js` source。
