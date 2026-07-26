# 核心資料模型

## ChatState V2

逐聊天資料保存在目前聊天的 `chatMetadata["fushenglu.chatState"]`。第二階段只建立
通用同步核心與測試狀態，不包含商店、衣櫥、技能或其他正式玩法資料。

```ts
interface ChatStateV2 {
  schemaVersion: 2;
  updatedAt: string | null;
  draftActions: DraftTestAction[];
  sync: SyncStateV1;
  batches: EventBatchV1[];
  events: CoreEventV1[];
  pendingItems: PendingItemV1[];
  handoffItems: HandoffItemV1[];
  committedBatchIds: string[];
  testState: TestStateV1;
  legacy: LegacyPrototypeStateV1;
}

interface SyncStateV1 {
  schemaVersion: 1;
  lastSuccessfulIndex: number;
  processedSlotKeys: string[];
  ignoredSlotKeys: string[];
  capability:
    | "stable_message_id"
    | "reproducible_fingerprint"
    | "index_fallback";
  limitation: string | null;
  branchFingerprint: string;
}
```

- V0／V1 原型會遷移到 V2，舊示例值只保存在 `legacy`。
- 未知未來版本或損壞的 V2 子資料會停止覆寫。
- 每個持久化實體與狀態紀錄都有自己的 `schemaVersion`。
- `committedBatchIds` 是提交冪等集合；不得重複。

## 訊息引用

```ts
interface MessageRefV1 {
  schemaVersion: 1;
  index: number;
  role: "user" | "assistant";
  content: string;
  stableMessageId: string | null;
  swipeId: string | null;
  sentAt: string | null;
  slotKey: string;
  fingerprint: string;
  messageRef: string;
  referenceMethod:
    | "stable_message_id"
    | "reproducible_fingerprint"
    | "index_fallback";
}
```

`slotKey` 不包含目前 Swipe，已同步訊息換 Swipe 後仍屬同一訊息槽，避免替代回答重複套用。
`messageRef` 另外包含 Swipe 與內容指紋，供證據與分支核對。

## 批次

```ts
type BatchStatus =
  | "draft"
  | "analysis_pending"
  | "review_ready"
  | "committing"
  | "committed"
  | "handoff_pending"
  | "complete"
  | "failed";

interface EventBatchV1 {
  schemaVersion: 1;
  batchId: string;
  source: "turn" | "correction" | "pending_resolution" | "undo";
  status: BatchStatus;
  statusHistory: StatusHistoryV1[];
  inputMessages: MessageRefV1[];
  inputSlotKeys: string[];
  sourceMessageRefs: string[];
  branchFingerprint: string;
  draftActions: DraftTestAction[];
  detectedChanges: ReviewProposalV1[];
  uncertainItems: ReviewProposalV1[];
  evidence: EvidenceRefV1[];
  handoffDrafts: HandoffDraftV1[];
  acceptedProposalIds: string[];
  rejectedProposalIds: string[];
  committedEventIds: string[];
  pendingItemIds: string[];
  failurePhase: "analysis" | "commit" | "handoff" | null;
  failureMessage: string | null;
  retryCount: number;
  revertedByBatchId: string | null;
}
```

正式事件、通用測試記錄與 `committedBatchIds` 在同一次 metadata 保存中寫入。保存失敗時，
整個記憶體值回復；同一 `batchId` 再提交只回傳既有狀態。

## 劇情分析 Schema

分析最外層固定包含：

```ts
interface StoryAnalysisV1 {
  schemaVersion: 1;
  storyTimeChanges: ProposedChangeV1[];
  inventoryChanges: ProposedChangeV1[];
  currencyChanges: ProposedChangeV1[];
  wardrobeChanges: ProposedChangeV1[];
  skillChanges: ProposedChangeV1[];
  cultivationChanges: ProposedChangeV1[];
  personChanges: ProposedChangeV1[];
  placeChanges: ProposedChangeV1[];
  evaluationChanges: ProposedChangeV1[];
  uncertainItems: ProposedChangeV1[];
  evidence: EvidenceRefV1[];
}

interface ProposedChangeV1 {
  proposalId: string;
  kind:
    | "story_time" | "inventory" | "currency" | "wardrobe"
    | "skill" | "cultivation" | "person" | "place"
    | "evaluation" | "conflict" | "other";
  operation: string;
  value: JsonValue;
  confidence: number; // 0..1
  evidenceMessageRef: string;
  reason: string;
  severity: "minor" | "moderate" | "major" | "critical";
  dedupeKey: string;
  timelineContext?: "main" | "memory" | "quote" | "dream" | "unknown";
}
```

`story_time` 必須提供 `timelineContext`。非 `main` 的時間候選一律預設進待確認。
任一欄位或任一候選不合法時整份分析失敗，不保留部分結果。

## 待確認

```ts
interface PendingItemV1 {
  schemaVersion: 1;
  pendingId: string;
  batchId: string;
  kind:
    | "story_time" | "inventory_currency" | "wardrobe"
    | "person" | "place" | "skill" | "cultivation"
    | "evaluation" | "conflict" | "other";
  proposal: ReviewProposalV1;
  evidence: EvidenceRefV1[];
  status: "pending" | "accepted" | "rejected" | "edited" | "deferred";
  decisionHistory: PendingDecisionV1[];
  deletedAt: string | null;
}
```

拒絕與稍後處理不建立正式事件。同意／修改會用新的 resolution `batchId` 寫入第二階段通用
測試狀態；所有決定保留於 `decisionHistory`。

## 交接

```ts
interface HandoffItemV1 {
  schemaVersion: 1;
  handoffId: string;
  batchId: string;
  text: string;
  mode: "until_changed" | "next_generation" | "never";
  stateType: string;
  active: boolean;
  sourceEventIds: string[];
  lastInjectedGenerationId: string | null;
  consumedAt: string | null;
  replacedBy: string | null;
  deletedAt: string | null;
}
```

- 交接只可由已提交事件產生。
- `next_generation` 只有在相同 `generationId` 的 assistant 回覆成功 `saveChat()` 後才消耗。
- `until_changed` 由相同 `stateType` 的新項目取代。
- `never` 不注入。

## 第二階段正式資料邊界

`CoreEventV1` 與 `TestStateV1` 只驗證原子保存、冪等、待確認、修正與撤銷。它們不是正式
貨幣、物品、衣櫥、技能或人物資料庫。第三階段才可把已驗證核心接到正式業務模型。
