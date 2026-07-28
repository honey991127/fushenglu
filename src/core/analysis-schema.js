export const ANALYSIS_SCHEMA_VERSION = 1;

export const ANALYSIS_CHANGE_BUCKETS = Object.freeze([
  'storyTimeChanges',
  'inventoryChanges',
  'currencyChanges',
  'wardrobeChanges',
  'skillChanges',
  'cultivationChanges',
  'personChanges',
  'placeChanges',
  'evaluationChanges',
]);

export const PROPOSAL_KINDS = Object.freeze([
  'story_time',
  'inventory',
  'currency',
  'wardrobe',
  'skill',
  'cultivation',
  'person',
  'place',
  'evaluation',
  'conflict',
  'other',
]);

export const PROPOSAL_SEVERITIES = Object.freeze([
  'minor',
  'moderate',
  'major',
  'critical',
]);

export const TIMELINE_CONTEXTS = Object.freeze([
  'main',
  'memory',
  'quote',
  'dream',
  'unknown',
]);

const BUCKET_KIND = Object.freeze({
  storyTimeChanges: 'story_time',
  inventoryChanges: 'inventory',
  currencyChanges: 'currency',
  wardrobeChanges: 'wardrobe',
  skillChanges: 'skill',
  cultivationChanges: 'cultivation',
  personChanges: 'person',
  placeChanges: 'place',
  evaluationChanges: 'evaluation',
});

const proposalJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'proposalId',
    'kind',
    'operation',
    'value',
    'confidence',
    'evidenceMessageRef',
    'reason',
    'severity',
    'dedupeKey',
  ],
  properties: {
    proposalId: { type: 'string', minLength: 1 },
    kind: { type: 'string', enum: [...PROPOSAL_KINDS] },
    operation: { type: 'string', minLength: 1 },
    value: {},
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    evidenceMessageRef: { type: 'string', minLength: 1 },
    reason: { type: 'string', minLength: 1 },
    severity: { type: 'string', enum: [...PROPOSAL_SEVERITIES] },
    dedupeKey: { type: 'string', minLength: 1 },
    timelineContext: { type: 'string', enum: [...TIMELINE_CONTEXTS] },
  },
};

export const STORY_ANALYSIS_JSON_SCHEMA = Object.freeze({
  name: 'fushenglu_story_analysis',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'schemaVersion',
      ...ANALYSIS_CHANGE_BUCKETS,
      'uncertainItems',
      'evidence',
    ],
    properties: {
      schemaVersion: { type: 'integer', const: ANALYSIS_SCHEMA_VERSION },
      ...Object.fromEntries(
        ANALYSIS_CHANGE_BUCKETS.map((bucket) => [
          bucket,
          {
            type: 'array',
            items: proposalJsonSchema,
          },
        ]),
      ),
      uncertainItems: {
        type: 'array',
        items: proposalJsonSchema,
      },
      evidence: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['messageRef', 'quote'],
          properties: {
            messageRef: { type: 'string', minLength: 1 },
            quote: { type: 'string' },
          },
        },
      },
    },
  },
});

export const VALIDATION_RESULT_JSON_SCHEMA = Object.freeze({
  name: 'fushenglu_validation_result',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'valid', 'issues'],
    properties: {
      schemaVersion: { type: 'integer', const: 1 },
      valid: { type: 'boolean' },
      issues: {
        type: 'array',
        items: { type: 'string' },
      },
    },
  },
});

export class AnalysisSchemaError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = 'AnalysisSchemaError';
    this.issues = [...issues];
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonCompatible(value, seen = new Set()) {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true;
  }

  if (typeof value !== 'object' || seen.has(value)) {
    return false;
  }

  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonCompatible(item, seen))
    : isPlainObject(value) &&
      Object.values(value).every((item) => isJsonCompatible(item, seen));
  seen.delete(value);
  return valid;
}

function validateProposal(proposal, path, expectedKind, issues) {
  if (!isPlainObject(proposal)) {
    issues.push(`${path} 必須是物件`);
    return;
  }

  for (const key of [
    'proposalId',
    'kind',
    'operation',
    'evidenceMessageRef',
    'reason',
    'severity',
    'dedupeKey',
  ]) {
    if (typeof proposal[key] !== 'string' || proposal[key].trim() === '') {
      issues.push(`${path}.${key} 必須是非空字串`);
    }
  }

  if (!Object.hasOwn(proposal, 'value') || !isJsonCompatible(proposal.value)) {
    issues.push(`${path}.value 必須是可序列化的 JSON 值`);
  }

  if (
    typeof proposal.confidence !== 'number' ||
    !Number.isFinite(proposal.confidence) ||
    proposal.confidence < 0 ||
    proposal.confidence > 1
  ) {
    issues.push(`${path}.confidence 必須介於 0 與 1`);
  }

  if (!PROPOSAL_KINDS.includes(proposal.kind)) {
    issues.push(`${path}.kind 不支援`);
  } else if (expectedKind && proposal.kind !== expectedKind) {
    issues.push(`${path}.kind 必須是 ${expectedKind}`);
  }

  if (!PROPOSAL_SEVERITIES.includes(proposal.severity)) {
    issues.push(`${path}.severity 不支援`);
  }

  if (
    proposal.kind === 'story_time' &&
    !TIMELINE_CONTEXTS.includes(proposal.timelineContext)
  ) {
    issues.push(`${path}.timelineContext 必須標示主線、回憶、引用、夢境或未知`);
  } else if (
    proposal.timelineContext !== undefined &&
    !TIMELINE_CONTEXTS.includes(proposal.timelineContext)
  ) {
    issues.push(`${path}.timelineContext 不支援`);
  }
}

export function createEmptyAnalysisResult() {
  return {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    ...Object.fromEntries(ANALYSIS_CHANGE_BUCKETS.map((bucket) => [bucket, []])),
    uncertainItems: [],
    evidence: [],
  };
}

function cloneJson(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function splitAnalysisMessages(
  messages,
  {
    maxMessages = 8,
    maxCharacters = 9000,
  } = {},
) {
  if (!Array.isArray(messages)) {
    throw new TypeError('待分析訊息必須是陣列');
  }

  if (!Number.isInteger(maxMessages) || maxMessages < 1) {
    throw new TypeError('maxMessages 必須是正整數');
  }

  if (!Number.isInteger(maxCharacters) || maxCharacters < 1000) {
    throw new TypeError('maxCharacters 必須是至少 1000 的整數');
  }

  const chunks = [];
  let current = [];
  let characterCount = 0;

  for (const message of messages) {
    const size =
      String(message?.messageRef ?? '').length +
      String(message?.role ?? '').length +
      String(message?.content ?? '').length;
    const exceedsLimit =
      current.length > 0 &&
      (current.length >= maxMessages ||
        characterCount + size > maxCharacters);

    if (exceedsLimit) {
      chunks.push(current);
      current = [];
      characterCount = 0;
    }

    current.push(cloneJson(message));
    characterCount += size;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

export function mergeAnalysisResults(results = []) {
  if (!Array.isArray(results)) {
    throw new TypeError('待合併分析結果必須是陣列');
  }

  const merged = createEmptyAnalysisResult();
  const seenDedupeKeys = new Set();
  const seenProposalIds = new Set();
  const seenEvidence = new Set();
  const buckets = [...ANALYSIS_CHANGE_BUCKETS, 'uncertainItems'];

  results.forEach((rawResult, resultIndex) => {
    const result = assertAnalysisResult(
      normalizeAnalysisResultShape(rawResult),
    );

    for (const bucket of buckets) {
      result[bucket].forEach((rawProposal, proposalIndex) => {
        const dedupeIdentity =
          `${rawProposal.kind}:${rawProposal.dedupeKey}`;

        if (seenDedupeKeys.has(dedupeIdentity)) {
          return;
        }

        let proposalId = rawProposal.proposalId;

        if (seenProposalIds.has(proposalId)) {
          proposalId =
            `${proposalId}-part-${resultIndex + 1}-${proposalIndex + 1}`;
        }

        while (seenProposalIds.has(proposalId)) {
          proposalId = `${proposalId}-duplicate`;
        }

        const proposal = {
          ...cloneJson(rawProposal),
          proposalId,
        };

        merged[bucket].push(proposal);
        seenDedupeKeys.add(dedupeIdentity);
        seenProposalIds.add(proposalId);
      });
    }

    for (const evidence of result.evidence) {
      const identity = `${evidence.messageRef}\n${evidence.quote}`;

      if (seenEvidence.has(identity)) {
        continue;
      }

      merged.evidence.push(cloneJson(evidence));
      seenEvidence.add(identity);
    }
  });

  return assertAnalysisResult(merged);
}

export function normalizeAnalysisResultShape(value) {
  if (!isPlainObject(value)) {
    return value;
  }

  const knownKeys = new Set([
    'schemaVersion',
    'schema_version',
    'version',
    ...ANALYSIS_CHANGE_BUCKETS,
    'story_time_changes',
    'inventory_changes',
    'currency_changes',
    'wardrobe_changes',
    'skill_changes',
    'cultivation_changes',
    'person_changes',
    'place_changes',
    'evaluation_changes',
    'uncertainItems',
    'uncertain_items',
    'evidence',
    'evidences',
  ]);
  const hasKnownKey = Object.keys(value).some((key) => knownKeys.has(key));
  const wrapperKey = ['analysis', 'result', 'data', 'output'].find(
    (key) => !hasKnownKey && isPlainObject(value[key]),
  );
  const source = wrapperKey ? value[wrapperKey] : value;
  const aliases = {
    storyTimeChanges: ['story_time_changes'],
    inventoryChanges: ['inventory_changes'],
    currencyChanges: ['currency_changes'],
    wardrobeChanges: ['wardrobe_changes'],
    skillChanges: ['skill_changes'],
    cultivationChanges: ['cultivation_changes'],
    personChanges: ['person_changes'],
    placeChanges: ['place_changes'],
    evaluationChanges: ['evaluation_changes'],
    uncertainItems: ['uncertain_items'],
    evidence: ['evidences'],
  };
  const recognized = Object.keys(source).some((key) => knownKeys.has(key));

  if (!recognized && Object.keys(source).length > 0) {
    return value;
  }

  const normalized = {
    ...source,
    schemaVersion:
      source.schemaVersion ?? source.schema_version ?? source.version ?? ANALYSIS_SCHEMA_VERSION,
  };

  for (const bucket of ANALYSIS_CHANGE_BUCKETS) {
    const alias = aliases[bucket]?.find((key) => Object.hasOwn(source, key));
    normalized[bucket] = source[bucket] ?? (alias ? source[alias] : []);
  }

  const uncertainAlias = aliases.uncertainItems.find((key) =>
    Object.hasOwn(source, key),
  );
  normalized.uncertainItems =
    source.uncertainItems ?? (uncertainAlias ? source[uncertainAlias] : []);

  const evidenceAlias = aliases.evidence.find((key) =>
    Object.hasOwn(source, key),
  );
  normalized.evidence =
    source.evidence ?? (evidenceAlias ? source[evidenceAlias] : []);

  delete normalized.schema_version;
  delete normalized.version;
  for (const aliasList of Object.values(aliases)) {
    for (const alias of aliasList) {
      delete normalized[alias];
    }
  }

  return normalized;
}

export function validateAnalysisResult(value) {
  const issues = [];

  if (!isPlainObject(value)) {
    return {
      ok: false,
      issues: ['分析結果必須是 JSON 物件'],
    };
  }

  if (value.schemaVersion !== ANALYSIS_SCHEMA_VERSION) {
    issues.push(`schemaVersion 必須是 ${ANALYSIS_SCHEMA_VERSION}`);
  }

  for (const bucket of ANALYSIS_CHANGE_BUCKETS) {
    if (!Array.isArray(value[bucket])) {
      issues.push(`${bucket} 必須是陣列`);
      continue;
    }

    value[bucket].forEach((proposal, index) => {
      validateProposal(proposal, `${bucket}[${index}]`, BUCKET_KIND[bucket], issues);
    });
  }

  if (!Array.isArray(value.uncertainItems)) {
    issues.push('uncertainItems 必須是陣列');
  } else {
    value.uncertainItems.forEach((proposal, index) => {
      validateProposal(proposal, `uncertainItems[${index}]`, null, issues);
    });
  }

  if (!Array.isArray(value.evidence)) {
    issues.push('evidence 必須是陣列');
  } else {
    value.evidence.forEach((evidence, index) => {
      if (!isPlainObject(evidence)) {
        issues.push(`evidence[${index}] 必須是物件`);
        return;
      }

      if (
        typeof evidence.messageRef !== 'string' ||
        evidence.messageRef.trim() === ''
      ) {
        issues.push(`evidence[${index}].messageRef 必須是非空字串`);
      }

      if (typeof evidence.quote !== 'string') {
        issues.push(`evidence[${index}].quote 必須是字串`);
      }
    });
  }

  const proposalIds = [];
  const allBuckets = [...ANALYSIS_CHANGE_BUCKETS, 'uncertainItems'];

  for (const bucket of allBuckets) {
    for (const proposal of Array.isArray(value[bucket]) ? value[bucket] : []) {
      if (typeof proposal?.proposalId === 'string') {
        if (proposalIds.includes(proposal.proposalId)) {
          issues.push(`proposalId 重複：${proposal.proposalId}`);
        }

        proposalIds.push(proposal.proposalId);
      }
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

export function assertAnalysisResult(value) {
  const validation = validateAnalysisResult(value);

  if (!validation.ok) {
    throw new AnalysisSchemaError(
      `AI 分析結果不符合 Schema：${validation.issues.join('；')}`,
      validation.issues,
    );
  }

  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function parseJsonObject(content) {
  if (typeof content !== 'string' || content.trim() === '') {
    throw new AnalysisSchemaError('AI 沒有回傳可解析的 JSON');
  }

  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const candidates = [trimmed];
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of [...new Set(candidates)]) {
    try {
      const parsed = JSON.parse(candidate);

      if (!isPlainObject(parsed)) {
        throw new AnalysisSchemaError('AI JSON 最外層必須是物件');
      }

      return parsed;
    } catch (error) {
      if (error instanceof AnalysisSchemaError) {
        throw error;
      }
    }
  }

  throw new AnalysisSchemaError('AI 回傳內容不是合法 JSON，未套用任何結果');
}

export function parseAndValidateAnalysis(content) {
  return assertAnalysisResult(
    normalizeAnalysisResultShape(parseJsonObject(content)),
  );
}

export function validateValidationResult(value) {
  if (!isPlainObject(value)) {
    throw new AnalysisSchemaError('校驗模型結果必須是 JSON 物件');
  }

  if (
    value.schemaVersion !== 1 ||
    typeof value.valid !== 'boolean' ||
    !Array.isArray(value.issues) ||
    value.issues.some((issue) => typeof issue !== 'string')
  ) {
    throw new AnalysisSchemaError('校驗模型結果不符合 Schema');
  }

  return {
    schemaVersion: 1,
    valid: value.valid,
    issues: [...value.issues],
  };
}
