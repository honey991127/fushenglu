# 核心資料模型

```ts
interface BaseEntity {
  id: string;
  chatId: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

interface EventBatch extends BaseEntity {
  batchId: string;
  anchorMessageId: string;
  anchorSwipeId?: string;
  branchFingerprint?: string;
  status: "prepared" | "committed" | "analysis_pending" |
          "analysis_complete" | "handoff_pending" | "complete" | "failed";
  actions: GameEvent[];
  detectedChanges: ProposedChange[];
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
