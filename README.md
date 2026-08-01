# 浮生錄 0.5.0

浮生錄是給 iPhone TauriTavern／SillyTavern 使用的純前端 extension。它與主聊天模型分離，透過使用者設定的 OpenAI-compatible API 分析聊天，將候選交給本地規則引擎與使用者確認後，才保存為每個聊天獨立的 ChatState V5。

## 0.5.0 功能

- 每個聊天各自保存 ChatState V5、事件帳本、世界規則、pending decision 與歷史匯入進度。
- AI 只提出候選；schema validation、candidate normalizer、semantic policy 與 fact/event id 都在本地執行。
- 歷史聊天以 chunk 掃描，使用 rolling context，並只使用 V5 根層 `historyImportProgress` 恢復進度。
- 已確認事件重建唯一的 `currentSnapshot`：時間、地點、資產、貨幣、人物狀態與關係都由帳本導出。
- 每輪提供一次總確認；可選擇只自動提交 policy 已判定為安全的項目，pending 永遠不會自動提交。
- canonical handoff 僅由已提交的 currentSnapshot 生成，並同步到宿主 prompt。
- 可重置目前聊天的分析資料；API 設定保留，世界規則可選擇保留或清除。

## 開發與建置

需要 Node.js 20 以上。安裝依賴後執行：

```bash
npm run verify
```

`verify` 會進行語法檢查、產生 cache-safe runtime、再執行測試。可單獨執行：

```bash
npm run check
npm run build
npm test
```

建置輸出在 `dist/fushenglu/`。build 會從唯一的 `src/` 原始碼與 manifest 版本生成帶 hash 的 browser ES module closure；不要手動維護版本化 runtime 檔案。

## 安裝與 iPhone 注意事項

將 `dist/fushenglu/` 安裝為 TauriTavern／SillyTavern extension，重新載入後應顯示 `v0.5.0`。iPhone WebView 的 CORS、TLS、長歷史掃描效能與宿主 capability 差異會影響實機結果；請依 [iPhone 實機清單](docs/IPHONE-TEST-CHECKLIST.md) 驗收。診斷資訊不得包含 API Key。

更多細節請參考：

- [架構](docs/ARCHITECTURE.md)
- [資料模型](docs/DATA_MODEL.md)
- [驗收測試](docs/ACCEPTANCE_TESTS.md)
- [0.5.0 migration](docs/MIGRATION-0.5.0.md)
