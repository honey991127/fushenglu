# 0.5.0 架構

浮生錄是瀏覽器 ES modules extension；runtime 不依賴 Node server plugin 或 Node-only API。`src/index.js` 建立 TauriTavern bridge、每聊天 metadata store、API settings store、API client 與手機優先 UI。

```text
聊天／歷史訊息
  → OpenAI-compatible API（候選）
  → analysis-schema validation
  → candidate normalizer → semantic classifier → analysis policy
  → review_ready / pending
  → committed events → eventLedger → rebuild currentSnapshot
  → canonical handoff sections → metadata save → host prompt
```

`core/` 的責任分離如下：

- `analysis-schema`、`candidate-normalizer`、`semantic-classifier`、`analysis-policy`：不信任模型輸出並以本地規則決定 disposition。
- `turn-sync`：batch lifecycle、commit、pending decision、軟刪除與 rebuild 接線。
- `chat-state`／`snapshot-reducer`：V5 驗證、migration、reset 及從 event ledger 產生唯一 snapshot。
- `history-consolidation`：chunk boundaries、rolling context、時間合併與 V5 history progress。
- `snapshot-handoff`：僅以 currentSnapshot 產生七個 canonical sections。
- `integrations/tauritavern`：metadata、CHAT_CHANGED、host prompt 與 generation lifecycle。
- `ui/`：呈現與使用者動作；不得直接寫入 currentSnapshot 或 eventLedger。

build 由 `scripts/build.mjs` 從 manifest 版本替換 `src/version.js` placeholder，並將 closure 以內容 hash 寫入 `dist/fushenglu/manifest.json` 指向的 runtime。只有 `src/` 是可編輯 runtime source。
