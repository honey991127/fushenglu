# ChatState V5 資料模型

每個聊天的 metadata 僅保存自己的 ChatState V5；API settings 屬於插件全域設定，不在 ChatState。

```text
ChatStateV5
├─ worldRules
├─ entities / relationships
├─ events + eventLedger
├─ currentSnapshot
├─ batches + pendingItems + pendingDecisionRecords
├─ handoffItems
└─ historyImportProgress
```

`currentSnapshot` 不是第二份權威資料。它完全由非 deleted、已提交、main timeline 的 events 依穩定 source order rebuild。資產至少記錄 owner、ownership、container、quantity 與 current；owner 或數量缺失不猜測為玩家或 1。`quantity` 為 `{ exact, unit, text, isExact }`。

`historyImportProgress` 是唯一正式歷史續跑格式，包含 `schemaVersion`、`pipelineVersion`、`branchFingerprint`、`messageRefsHash`、`chunkBoundaries`、`completedChunkIndexes`、`failedChunkIndex`、`rollingContext` 與 `updatedAt`。訊息分支或 boundaries 改變時進度失效。

handoffItems 是由 currentSnapshot 生成的 canonical sections：`current_time`、`current_place`、`player_carried_assets`、`player_stored_assets`、`player_currencies`、`durable_statuses`、`relationships`。proposal、review item 與 handoff draft 不可作為正式 prompt 來源。

V4 migration 會建立 V5 根欄位但不猜測污染或 owner 缺失資料；未知未來 schemaVersion 停止覆寫。
