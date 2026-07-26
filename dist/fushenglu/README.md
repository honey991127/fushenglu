# fushenglu（浮生錄）

fushenglu 是面向 iPhone TauriTavern / SillyTavern 的前端擴充。主聊天 AI 與插件 AI 完全分離；插件使用自訂 OpenAI-compatible API。

## 目前狀態

第一階段技術原型已可安裝，範圍僅包含：

- 「浮生錄」固定入口。
- 手機優先的全屏頁。
- 目前聊天識別。
- 帶 `schemaVersion` 的逐聊天儲存。
- 示例值的寫入、讀取與清空測試。
- 舊版最小資料遷移。

商店、技能、衣櫥、活動、書信、聊天分析、帳本提交與主聊天交接都尚未實作。`mockups/ui-v13.html` 仍只作流程與視覺參考。

## 執行環境

- 執行時：iPhone TauriTavern 或相容的 SillyTavern UI extension 環境。
- 開發與建置：Node.js 20 或以上。
- 執行時不需要 Node server plugin，也不呼叫任何本專案提供的後端服務。

## 測試與建置

```bash
npm run verify
```

此命令會依序執行語法檢查、Node 內建測試與建置。建置結果位於 `dist/fushenglu/`，內容是可由宿主直接載入的純前端擴充。

也可分開執行：

```bash
npm run check
npm test
npm run build
```

## 安裝

### 從 Git 倉庫安裝

1. 將本倉庫推送到 TauriTavern 可存取的 Git URL。
2. 在 TauriTavern 的 Extensions／擴充功能頁選擇安裝第三方擴充。
3. 貼上倉庫 URL 並安裝。
4. 啟用「浮生錄」後重新載入頁面。

倉庫根目錄已包含正式 `manifest.json`，不需要在 iPhone 上執行 Node。

### 手動安裝建置結果

1. 在開發電腦執行 `npm run build`。
2. 將完整的 `dist/fushenglu/` 資料夾放入宿主所使用的第三方 UI extension 目錄。
3. 啟用擴充並重新載入。

實際資料目錄會依 TauriTavern 版本與安裝模式而異，應以該版本的第三方擴充管理介面為準。

## 原型操作

1. 先在宿主開啟一段聊天。
2. 點右下角「浮生錄」。
3. 確認頁面顯示目前聊天識別。
4. 輸入示例值後按「寫入」，再按「讀取」核對。
5. 切換聊天後再打開浮生錄；其他聊天的示例值不應出現。
6. 「清空」只清除目前聊天的示例值。

擴充只使用公開的 `SillyTavern.getContext()`、`chatMetadata`、`saveMetadata()` 與 `CHAT_CHANGED` 事件。缺少必要接口時，頁面會顯示明確錯誤並停用儲存按鈕。

## iPhone 實機待確認

- TauriTavern 目前版本是否公開上述全部接口。
- 第三方擴充安裝、啟用、更新與重新載入流程。
- 全屏頁的安全區、動態視窗高度、鍵盤彈出與旋轉行為。
- 實際切換單人聊天、群組聊天、分支／Swipe 後的資料隔離。
- App 強制關閉再開後，聊天 metadata 是否正常持久化。
