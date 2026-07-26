# 測試

目前測試涵蓋：

- `ChatState` V1 建立、驗證與 V0 遷移。
- 未知或損壞資料不被覆寫。
- 公開 TauriTavern／SillyTavern capability detection。
- 示例值的逐聊天讀取、寫入、清空與聊天切換隔離。
- `CHAT_CHANGED` 訂閱。

執行：

```bash
npm test
```
