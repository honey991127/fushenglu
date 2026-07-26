# 技術架構

## 平台

- iPhone TauriTavern
- 純前端擴充
- 外部 OpenAI-compatible API
- 不依賴本機 Node 服務

## 建議目錄

```text
src/
  core/
    lifecycle/
    storage/
    events/
    schema/
    api/
    handoff/
  modules/
    ledger/
    wardrobe/
    skills/
    cultivation/
    shops/
    activities/
    rankings/
    evaluations/
    correspondence/
    world-library/
    assistant/
  integrations/
    tauritavern/
    baibai-book/
  ui/
    shell/
    screens/
    components/
```

## 資料流

```text
chat -> new-message detector -> extraction API -> schema validator
     -> deterministic rules -> optional verification API
     -> confirmed changes / pending review
     -> event log + snapshot -> handoff builder -> next generation
```

## 原子提交

狀態：`prepared -> committed -> analysis_pending -> analysis_complete -> handoff_pending -> complete`。
AI 失敗只令分析或交接待重試，不得撤銷已成功交易，也不得再次扣款。

## 防重複與分支

保存 `batchId`、`sourceMessageId`、`sourceEventId`、`dedupeKey`、`anchorSwipeId`、`branchFingerprint`。
主聊天只是承認先前插件操作時，不再次執行同一變動。

## API 與柏寶書

- API Key 不進匯出、不進日誌。
- API 設定與主聊天連接分離。
- 柏寶書為可選唯讀來源。
- 新插件是交易、衣櫥、技能、活動、排名、評價和書信的權威來源。
