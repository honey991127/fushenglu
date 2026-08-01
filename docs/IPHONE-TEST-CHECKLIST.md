# iPhone 實機測試清單（0.5.0）

每一步失敗時請保存浮生錄版本、目前聊天 ID、可重現訊息與不含 API Key 的錯誤文字；不要匯出或截圖 API Key。

1. 安裝 `dist/fushenglu/`。預期 extension 可載入且不要求 Node server plugin。
2. 開啟浮生錄。預期首頁與設定頁顯示 `v0.5.0`。
3. 新建測試聊天。預期首頁為空白，沒有舊聊天的資料或交接。
4. 送出一個普通回合。預期候選先在總確認／待確認中出現，未確認前不寫入正式摘要。
5. 點擊一次「確認本輪」。預期安全候選一次寫入，成功文案為「已更新浮生錄」。
6. 製造 owner 或 quantity 不足的候選。預期進待確認，不進玩家行囊。
7. 驗收人物、行囊、貨幣與世界規則。預期 NPC 資產不屬於玩家、房間存放標示不在身上、貨幣 tier 不混合。
8. 切換至另一聊天再切回。預期兩個聊天資料與 host prompt 完全隔離。
9. 在主聊天生成一次 assistant 回覆。預期 canonical handoff 可用；只有 assistant 回覆成功保存後才消耗 next_generation。
10. 測試 regenerate 與 Swipe。預期不消耗 next_generation，並使不相容的歷史掃描進度失效。
11. 重置目前聊天。預期只清除本聊天分析資料，API settings 保留；依勾選結果保留或清除 world rules。
12. 最後才掃描舊聊天完整歷史。預期顯示進度、可在同一分支恢復；訊息 branch 改變時要求重新開始。
