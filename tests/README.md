# 測試

目前 Node 內建測試涵蓋：

- ChatState V2 建立、V0／V1 遷移、損壞／未來版本拒絕與安全匯出。
- 分析 JSON、全部候選 bucket、時間語境與全有或全無 Schema 驗證。
- API Key 遮蔽／匯出／日誌、Base URL、structured-output 降級與非法 JSON。
- 逐聊天資料隔離、宿主 capability detection、CHAT_CHANGED 與最小交接 bridge。
- 同 `batchId` 防重、failed 同批重試、訊息去重、Swipe 防重。
- next_generation 成功／失敗消耗及 until_changed 取代。
- 待確認拒絕、自然語言修正最後確認、回憶時間待確認。
- App 重開恢復、批次軟撤銷。
- 正式建置清單與 Node-only runtime import 掃描。

執行：

```bash
npm test
```

完整語法、測試與建置：

```bash
npm run verify
```
