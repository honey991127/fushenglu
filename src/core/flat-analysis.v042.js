import {
  ANALYSIS_CHANGE_BUCKETS,
  AnalysisSchemaError,
  PROPOSAL_KINDS,
  PROPOSAL_SEVERITIES,
  TIMELINE_CONTEXTS,
  assertAnalysisResult,
  createEmptyAnalysisResult,
  normalizeAnalysisResultShape,
  parseJsonObject,
} from './analysis-schema.v042.js';

const KIND_BUCKET = Object.freeze({
  story_time: 'storyTimeChanges',
  inventory: 'inventoryChanges',
  currency: 'currencyChanges',
  wardrobe: 'wardrobeChanges',
  skill: 'skillChanges',
  cultivation: 'cultivationChanges',
  person: 'personChanges',
  place: 'placeChanges',
  evaluation: 'evaluationChanges',
});

const FLAT_PROPOSAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'operation', 'value', 'evidenceMessageRef'],
  properties: {
    proposalId: { type: 'string' },
    kind: { type: 'string' },
    operation: { type: 'string' },
    value: {},
    confidence: { type: 'number' },
    evidenceMessageRef: { type: 'string' },
    evidenceQuote: { type: 'string' },
    reason: { type: 'string' },
    severity: { type: 'string' },
    dedupeKey: { type: 'string' },
    timelineContext: { type: 'string' },
    uncertain: { type: 'boolean' },
  },
};

export const FLAT_STORY_ANALYSIS_JSON_SCHEMA = Object.freeze({
  name: 'fushenglu_flat_story_analysis',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['changes'],
    properties: {
      schemaVersion: { type: 'integer' },
      changes: {
        type: 'array',
        items: FLAT_PROPOSAL_SCHEMA,
      },
      evidence: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['messageRef', 'quote'],
          properties: {
            messageRef: { type: 'string' },
            quote: { type: 'string' },
          },
        },
      },
    },
  },
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hashText(value) {
  const text = String(value);
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function toList(value) {
  if (value === undefined || value === null) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (!isPlainObject(value)) {
    return [value];
  }

  const looksLikeProposal = [
    'kind',
    'type',
    'category',
    'operation',
    'action',
    'value',
    'data',
    'details',
  ].some((key) => Object.hasOwn(value, key));

  if (looksLikeProposal) {
    return [value];
  }

  return Object.values(value).flatMap((item) =>
    Array.isArray(item) ? item : item === undefined || item === null ? [] : [item],
  );
}

function normalizeKind(value) {
  const source = String(value ?? '').trim().toLowerCase();
  const aliases = new Map([
    ['story_time', 'story_time'],
    ['storytime', 'story_time'],
    ['time', 'story_time'],
    ['時間', 'story_time'],
    ['时间', 'story_time'],
    ['inventory', 'inventory'],
    ['item', 'inventory'],
    ['items', 'inventory'],
    ['物品', 'inventory'],
    ['currency', 'currency'],
    ['money', 'currency'],
    ['貨幣', 'currency'],
    ['货币', 'currency'],
    ['靈石', 'currency'],
    ['灵石', 'currency'],
    ['wardrobe', 'wardrobe'],
    ['clothing', 'wardrobe'],
    ['outfit', 'wardrobe'],
    ['衣物', 'wardrobe'],
    ['穿著', 'wardrobe'],
    ['穿着', 'wardrobe'],
    ['skill', 'skill'],
    ['技能', 'skill'],
    ['cultivation', 'cultivation'],
    ['realm', 'cultivation'],
    ['修煉', 'cultivation'],
    ['修炼', 'cultivation'],
    ['境界', 'cultivation'],
    ['person', 'person'],
    ['character', 'person'],
    ['npc', 'person'],
    ['人物', 'person'],
    ['place', 'place'],
    ['location', 'place'],
    ['地點', 'place'],
    ['地点', 'place'],
    ['evaluation', 'evaluation'],
    ['reputation', 'evaluation'],
    ['評價', 'evaluation'],
    ['评价', 'evaluation'],
    ['conflict', 'conflict'],
    ['衝突', 'conflict'],
    ['冲突', 'conflict'],
    ['other', 'other'],
    ['其他', 'other'],
  ]);

  const normalized = aliases.get(source) ?? source;
  return PROPOSAL_KINDS.includes(normalized) ? normalized : 'other';
}

function normalizeConfidence(value) {
  let number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  if (number > 1 && number <= 100) {
    number /= 100;
  }

  return Math.max(0, Math.min(1, number));
}

function normalizeSeverity(value, confidence) {
  const source = String(value ?? '').trim().toLowerCase();
  const aliases = {
    low: 'minor',
    small: 'minor',
    medium: 'moderate',
    normal: 'moderate',
    high: 'major',
    severe: 'critical',
  };
  const normalized = aliases[source] ?? source;

  if (PROPOSAL_SEVERITIES.includes(normalized)) {
    return normalized;
  }

  return confidence >= 0.8 ? 'moderate' : 'major';
}

function normalizeTimelineContext(value) {
  const source = String(value ?? '').trim().toLowerCase();
  const aliases = {
    current: 'main',
    present: 'main',
    主線: 'main',
    主线: 'main',
    回憶: 'memory',
    回忆: 'memory',
    引用: 'quote',
    夢境: 'dream',
    梦境: 'dream',
    不明: 'unknown',
  };
  const normalized = aliases[source] ?? source;
  return TIMELINE_CONTEXTS.includes(normalized) ? normalized : 'unknown';
}

function normalizeProposal(raw, index) {
  const source = isPlainObject(raw) ? raw : { value: raw };
  const kind = normalizeKind(
    source.kind ?? source.type ?? source.category ?? source.changeType,
  );
  const operation = String(
    source.operation ?? source.action ?? source.change ?? 'record',
  ).trim() || 'record';
  const value = Object.hasOwn(source, 'value')
    ? source.value
    : source.data ?? source.details ?? source.result ?? source.amount ?? raw;
  const confidence = normalizeConfidence(
    source.confidence ?? source.certainty ?? source.score,
  );
  const severity = normalizeSeverity(
    source.severity ?? source.importance,
    confidence,
  );
  const evidenceMessageRef = String(
    source.evidenceMessageRef ??
      source.messageRef ??
      source.sourceMessageRef ??
      source.evidence?.messageRef ??
      `unresolved:${index + 1}`,
  ).trim() || `unresolved:${index + 1}`;
  const reason = String(
    source.reason ??
      source.explanation ??
      source.summary ??
      source.description ??
      '模型未提供原因，請人工核對。',
  ).trim() || '模型未提供原因，請人工核對。';
  const identity = JSON.stringify({
    kind,
    operation,
    value,
    evidenceMessageRef,
  });
  const proposalId = String(
    source.proposalId ?? source.id ?? `proposal-${hashText(identity)}`,
  ).trim() || `proposal-${hashText(identity)}`;
  const dedupeKey = String(
    source.dedupeKey ??
      source.dedupe_key ??
      `${kind}:${operation}:${hashText(identity)}`,
  ).trim() || `${kind}:${operation}:${hashText(identity)}`;
  const proposal = {
    proposalId,
    kind,
    operation,
    value,
    confidence,
    evidenceMessageRef,
    reason,
    severity,
    dedupeKey,
  };

  if (kind === 'story_time') {
    proposal.timelineContext = normalizeTimelineContext(
      source.timelineContext ?? source.timeline_context,
    );
  }

  return {
    proposal,
    uncertain:
      Boolean(source.uncertain) ||
      ['conflict', 'other'].includes(kind),
    evidenceQuote: String(
      source.evidenceQuote ??
        source.quote ??
        source.evidence?.quote ??
        reason,
    ),
  };
}

function containsLegacyBuckets(value) {
  return isPlainObject(value) &&
    [...ANALYSIS_CHANGE_BUCKETS, 'uncertainItems'].some((key) =>
      Object.hasOwn(value, key),
    );
}

function unwrap(value) {
  if (!isPlainObject(value)) {
    return value;
  }

  if (
    Object.hasOwn(value, 'changes') ||
    Object.hasOwn(value, 'proposals') ||
    Object.hasOwn(value, 'events') ||
    Object.hasOwn(value, 'items') ||
    containsLegacyBuckets(value)
  ) {
    return value;
  }

  for (const key of ['analysis', 'result', 'data', 'output']) {
    if (isPlainObject(value[key])) {
      return value[key];
    }
  }

  return value;
}

export function parseAndConvertFlatAnalysis(content) {
  const parsed = unwrap(parseJsonObject(content));

  if (containsLegacyBuckets(parsed)) {
    return assertAnalysisResult(normalizeAnalysisResultShape(parsed));
  }

  if (!isPlainObject(parsed)) {
    throw new AnalysisSchemaError('AI 分析結果不符合 Schema：必須是物件');
  }

  const hasChangesKey = ['changes', 'proposals', 'events', 'items', 'change'].some(
    (key) => Object.hasOwn(parsed, key),
  );

  if (!hasChangesKey) {
    throw new AnalysisSchemaError('AI 分析結果不符合 Schema：缺少 changes');
  }

  const rawChanges =
    parsed.changes ??
    parsed.proposals ??
    parsed.events ??
    parsed.items ??
    parsed.change;
  const result = createEmptyAnalysisResult();
  const evidenceSeen = new Set();

  toList(rawChanges).forEach((raw, index) => {
    const normalized = normalizeProposal(raw, index);
    const bucket = KIND_BUCKET[normalized.proposal.kind];

    if (bucket && !normalized.uncertain) {
      result[bucket].push(normalized.proposal);
    } else {
      result.uncertainItems.push(normalized.proposal);
    }

    const evidenceIdentity =
      `${normalized.proposal.evidenceMessageRef}\n${normalized.evidenceQuote}`;

    if (!evidenceSeen.has(evidenceIdentity)) {
      result.evidence.push({
        messageRef: normalized.proposal.evidenceMessageRef,
        quote: normalized.evidenceQuote,
      });
      evidenceSeen.add(evidenceIdentity);
    }
  });

  for (const evidence of toList(parsed.evidence ?? parsed.evidences)) {
    if (!isPlainObject(evidence)) {
      continue;
    }

    const messageRef = String(
      evidence.messageRef ?? evidence.evidenceMessageRef ?? '',
    ).trim();
    const quote = String(evidence.quote ?? evidence.text ?? '');

    if (!messageRef) {
      continue;
    }

    const identity = `${messageRef}\n${quote}`;

    if (!evidenceSeen.has(identity)) {
      result.evidence.push({ messageRef, quote });
      evidenceSeen.add(identity);
    }
  }

  return assertAnalysisResult(result);
}
