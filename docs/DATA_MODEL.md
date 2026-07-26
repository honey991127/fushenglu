# 核心資料模型

## 第一階段 ChatState

第一階段只實作以下最小資料。它保存在當前聊天的 `chatMetadata["fushenglu.chatState"]`，不包含任何遊戲模組資料。

```ts
interface ChatStateV1 {
  schemaVersion: 1;
  sampleValue: string | null;
  updatedAt: string | null;
}
```

- 無資料時建立 V1 空狀態。
- 無 `schemaVersion` 或 `schemaVersion: 0` 的原型資料可遷移到 V1。
- 遇到高於目前支援版本的資料時拒絕覆寫。
- 聊天識別由每次呼叫 `SillyTavern.getContext()` 取得，不以全域快取代替。

## 後續核心模型

```ts
interface BaseEntity {
  id: string;
  chatId: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

type BatchStatus =
  | "draft"
  | "analysis_pending"
  | "review_ready"
  | "committing"
  | "committed"
  | "handoff_pending"
  | "complete"
  | "failed";

interface EventBatch extends BaseEntity {
  batchId: string;
  anchorMessageId: string;
  anchorSwipeId?: string;
  branchFingerprint?: string;
  status: BatchStatus;
  actions: GameEvent[];
  detectedChanges: ProposedChange[];
  confirmedEventIds: string[];
  failurePhase?: "analysis" | "commit" | "handoff";
  failureMessage?: string;
}

interface HandoffItem extends BaseEntity {
  text: string;
  mode: "until_changed" | "next_generation" | "never";
  active: boolean;
  sourceEventIds: string[];
}

interface PendingItem extends BaseEntity {
  kind: "time" | "inventory" | "wardrobe" | "person" | "place" |
        "skill" | "cultivation" | "conflict" | "other";
  proposal: unknown;
  evidence: EvidenceRef[];
  status: "pending" | "accepted" | "rejected" | "edited";
}

interface Activity extends BaseEntity {
  title: string;
  organizer: string;
  description: string;
  registrationDeadline?: StoryDate;
  eligibility: RuleExpression[];
  registrationMethod: string;
  participationMethod: string;
  rankingBoardId?: string;
  playerStatus: "unknown" | "eligible" | "ineligible" | "registered" |
                "participating" | "completed" | "missed";
}

interface EvaluationRecord extends BaseEntity {
  domain: string;
  issuer: string;
  label: string;
  description: string;
  evidence: EvidenceRef[];
  effects: EvaluationEffect[];
}
```

## 提交不變量

- 玩家在插件內的操作先進 `ChatState` 的本輪暫存區，不直接建立正式 `GameEvent`。
- 按「結束本輪」才建立唯一 `batchId`；同一輪恢復或重試沿用該值。
- `review_ready` 的勾選只是提案，只有玩家最後確認後才能進 `committing`。
- 正式事件、帳本餘額、庫存、寄信與報名結果必須連同 `batchId` 冪等紀錄原子寫入。
- `committed` 後不得再次執行同一 `batchId` 的副作用。
- 明確小型變化可預設列入 `confirmedEventIds`；含糊、衝突或重大變化只能建立 `PendingItem`，除非玩家明確接受。
