import {
  ANALYSIS_CHANGE_BUCKETS,
  assertAnalysisResult,
  createEmptyAnalysisResult,
} from './analysis-schema.js';

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

const INTERNAL_REVIEW_KEYS = new Set([
  'schemaVersion',
  'originBucket',
  'uncertain',
  'reviewDisposition',
  'editedByPlayer',
  'payloadIssues',
  'repairStatus',
  'repairIssues',
]);

function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyText(value) {
  const text = String(value ?? '').trim();
  return text || '';
}

function firstText(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    const text = nonEmptyText(value);

    if (text) {
      return text;
    }
  }

  return '';
}

function firstNumber(source, keys) {
  for (const key of keys) {
    if (!Object.hasOwn(source ?? {}, key)) {
      continue;
    }

    const value = Number(source[key]);

    if (Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function valueObject(value) {
  return isPlainObject(value) ? { ...value } : {};
}

function validNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function normalizeInventoryValue(rawValue, operation) {
  const source = valueObject(rawValue);
  const directName =
    typeof rawValue === 'string' ? nonEmptyText(rawValue) : '';
  const name =
    firstText(source, [
      'name',
      'item',
      'itemName',
      'item_name',
      'title',
      'label',
      '名稱',
      '名称',
      '物品',
      '物品名稱',
      '物品名称',
    ]) || directName;
  const quantity =
    firstNumber(source, [
      'quantity',
      'amount',
      'count',
      'qty',
      'number',
      'value',
      '數量',
      '数量',
    ]) ?? (['add', 'subtract'].includes(operation) ? 1 : null);

  return {
    ...source,
    ...(name ? { name } : {}),
    ...(quantity !== null ? { quantity } : {}),
  };
}

function normalizeCurrencyValue(rawValue) {
  const source = valueObject(rawValue);
  const directName =
    typeof rawValue === 'string' ? nonEmptyText(rawValue) : '';
  const name =
    firstText(source, [
      'name',
      'currency',
      'currencyName',
      'currency_name',
      'title',
      'label',
      '名稱',
      '名称',
      '貨幣',
      '货币',
    ]) || directName;
  const amount = firstNumber(source, [
    'amount',
    'quantity',
    'count',
    'qty',
    'number',
    'value',
    '數量',
    '数量',
  ]);

  return {
    ...source,
    ...(name ? { name } : {}),
    ...(amount !== null ? { amount } : {}),
  };
}

function normalizeSkillValue(rawValue, operation) {
  const source = valueObject(rawValue);
  const directName =
    typeof rawValue === 'string' ? nonEmptyText(rawValue) : '';
  const name =
    firstText(source, [
      'name',
      'skill',
      'skillName',
      'skill_name',
      'title',
      'label',
      '名稱',
      '名称',
      '技能',
      '技能名稱',
      '技能名称',
    ]) || directName;
  const proficiency =
    firstNumber(source, [
      'proficiency',
      'level',
      'progress',
      'amount',
      'value',
      '熟練度',
      '熟练度',
    ]) ?? (operation === 'add' ? 1 : null);

  return {
    ...source,
    ...(name ? { name } : {}),
    ...(proficiency !== null ? { proficiency } : {}),
  };
}

function normalizeCultivationValue(rawValue) {
  const source = valueObject(rawValue);
  const directStage =
    typeof rawValue === 'string' ? nonEmptyText(rawValue) : '';
  const stage =
    firstText(source, [
      'stage',
      'name',
      'realm',
      'level',
      'title',
      'label',
      '境界',
      '階段',
      '阶段',
      '名稱',
      '名称',
    ]) || directStage;

  return {
    ...source,
    ...(stage ? { stage } : {}),
  };
}

function normalizeWardrobeValue(rawValue, operation) {
  const source = valueObject(rawValue);

  if (operation === 'wear') {
    const direct = firstText(source, [
      'name',
      'garment',
      'clothing',
      'item',
      'title',
      'label',
    ]);
    const garments = Array.isArray(source.garments)
      ? source.garments
      : direct
        ? [direct]
        : [];

    return {
      ...source,
      garments,
    };
  }

  const directName =
    typeof rawValue === 'string' ? nonEmptyText(rawValue) : '';
  const name =
    firstText(source, [
      'name',
      'garment',
      'clothing',
      'outfit',
      'item',
      'title',
      'label',
      '名稱',
      '名称',
      '衣物',
    ]) || directName;

  return {
    ...source,
    ...(name ? { name } : {}),
  };
}

function normalizeStatusValue(rawValue) {
  const source = valueObject(rawValue);
  const directStatus =
    typeof rawValue === 'string' ? nonEmptyText(rawValue) : '';
  const status =
    firstText(source, [
      'status',
      'name',
      'title',
      'label',
      '狀態',
      '状态',
    ]) || directStatus;

  return {
    ...source,
    ...(status ? { status } : {}),
  };
}

export function normalizeProposalPayload(proposal) {
  const next = clone(proposal);
  const rawValue = proposal?.value;

  if (proposal?.kind === 'inventory') {
    next.value = normalizeInventoryValue(rawValue, proposal.operation);
  } else if (proposal?.kind === 'currency') {
    next.value = normalizeCurrencyValue(rawValue);
  } else if (proposal?.kind === 'skill') {
    next.value = normalizeSkillValue(rawValue, proposal.operation);
  } else if (proposal?.kind === 'cultivation') {
    next.value = normalizeCultivationValue(rawValue);
  } else if (proposal?.kind === 'wardrobe') {
    next.value = normalizeWardrobeValue(rawValue, proposal.operation);
  } else if (
    proposal?.kind === 'other' &&
    proposal?.operation === 'set_status'
  ) {
    next.value = normalizeStatusValue(rawValue);
  }

  return next;
}

export function inspectProposalPayload(proposal) {
  const normalized = normalizeProposalPayload(proposal);
  const value = isPlainObject(normalized.value) ? normalized.value : {};
  const issues = [];

  if (normalized.kind === 'inventory') {
    if (!['add', 'subtract', 'set'].includes(normalized.operation)) {
      issues.push('物品操作不支援');
    }

    if (!nonEmptyText(value.name)) {
      issues.push('物品名稱缺失');
    }

    if (!validNonNegative(Number(value.quantity))) {
      issues.push('物品數量無效');
    }
  } else if (normalized.kind === 'currency') {
    if (!['add', 'subtract', 'set'].includes(normalized.operation)) {
      issues.push('貨幣操作不支援');
    }

    if (!nonEmptyText(value.name ?? value.currency)) {
      issues.push('貨幣名稱缺失');
    }

    if (!validNonNegative(Number(value.amount))) {
      issues.push('貨幣數量無效');
    }
  } else if (normalized.kind === 'skill') {
    if (!['add', 'set'].includes(normalized.operation)) {
      issues.push('技能操作不支援');
    }

    if (!nonEmptyText(value.name)) {
      issues.push('技能名稱缺失');
    }

    if (!validNonNegative(Number(value.proficiency))) {
      issues.push('技能熟練度無效');
    }
  } else if (normalized.kind === 'cultivation') {
    if (
      !['confirm_milestone', 'record_breakthrough', 'set'].includes(
        normalized.operation,
      )
    ) {
      issues.push('修煉操作不支援');
    }

    if (!nonEmptyText(value.stage ?? value.name)) {
      issues.push('修煉階段缺失');
    }
  } else if (normalized.kind === 'wardrobe') {
    if (normalized.operation === 'wear') {
      if (
        !Array.isArray(value.garments) ||
        value.garments
          .map((item) => nonEmptyText(item?.name ?? item))
          .filter(Boolean).length === 0
      ) {
        issues.push('穿著項目缺失');
      }
    } else if (
      ['add', 'set', 'update', 'save_outfit'].includes(normalized.operation)
    ) {
      if (!nonEmptyText(value.name)) {
        issues.push('衣物名稱缺失');
      }
    } else {
      issues.push('衣櫥操作不支援');
    }
  } else if (
    normalized.kind === 'other' &&
    normalized.operation === 'set_status' &&
    !nonEmptyText(value.status ?? value.name)
  ) {
    issues.push('狀態內容缺失');
  }

  return {
    proposal: normalized,
    complete: issues.length === 0,
    issues,
  };
}

function entries(result) {
  const output = [];

  for (const bucket of [...ANALYSIS_CHANGE_BUCKETS, 'uncertainItems']) {
    for (const proposal of result[bucket] ?? []) {
      output.push({ bucket, proposal });
    }
  }

  return output;
}

export function normalizeAnalysisPayloads(result) {
  const next = createEmptyAnalysisResult();

  for (const { bucket, proposal } of entries(result)) {
    next[bucket].push(normalizeProposalPayload(proposal));
  }

  next.evidence = clone(result.evidence ?? []);
  return assertAnalysisResult(next);
}

export function listIncompleteProposals(result) {
  return entries(result)
    .map(({ bucket, proposal }) => {
      const inspected = inspectProposalPayload(proposal);
      return {
        bucket,
        proposal: inspected.proposal,
        issues: inspected.issues,
        complete: inspected.complete,
      };
    })
    .filter((item) => !item.complete);
}

export function flattenAnalysisProposals(result) {
  return entries(result).map(({ proposal }) => clone(proposal));
}

export function replaceAnalysisProposal(
  result,
  proposalId,
  replacement,
  targetBucket = null,
) {
  const next = createEmptyAnalysisResult();
  const replacementBucket =
    targetBucket ??
    KIND_BUCKET[replacement.kind] ??
    'uncertainItems';

  for (const { bucket, proposal } of entries(result)) {
    if (proposal.proposalId === proposalId) {
      next[replacementBucket].push(clone(replacement));
    } else {
      next[bucket].push(clone(proposal));
    }
  }

  next.evidence = clone(result.evidence ?? []);
  return assertAnalysisResult(next);
}

export function markProposalUnresolved(result, item) {
  const original = item.proposal;
  const reasonSuffix = `自動修復未能從本聊天原文確定：${item.issues.join('；')}`;
  const unresolved = {
    ...clone(original),
    confidence: Math.min(Number(original.confidence) || 0, 0.49),
    severity: ['major', 'critical'].includes(original.severity)
      ? original.severity
      : 'major',
    reason: [nonEmptyText(original.reason), reasonSuffix]
      .filter(Boolean)
      .join('；'),
    repairStatus: 'unresolved',
    repairIssues: [...item.issues],
  };

  return replaceAnalysisProposal(
    result,
    original.proposalId,
    unresolved,
    'uncertainItems',
  );
}

export function proposalGroundingLabel(proposal) {
  const value = isPlainObject(proposal?.value) ? proposal.value : {};

  if (proposal?.kind === 'inventory') {
    return nonEmptyText(value.name);
  }

  if (proposal?.kind === 'currency') {
    return nonEmptyText(value.name ?? value.currency);
  }

  if (proposal?.kind === 'skill') {
    return nonEmptyText(value.name);
  }

  if (proposal?.kind === 'cultivation') {
    return nonEmptyText(value.stage ?? value.name);
  }

  if (proposal?.kind === 'wardrobe') {
    if (proposal.operation === 'wear') {
      return Array.isArray(value.garments)
        ? value.garments
            .map((item) => nonEmptyText(item?.name ?? item))
            .filter(Boolean)
            .join('\n')
        : '';
    }

    return nonEmptyText(value.name);
  }

  if (proposal?.kind === 'other' && proposal.operation === 'set_status') {
    return nonEmptyText(value.status ?? value.name);
  }

  return '';
}

export function selectRelevantMessages(
  messages,
  proposal,
  {
    radius = 3,
    fallbackCount = 6,
  } = {},
) {
  const source = Array.isArray(messages) ? messages : [];
  const index = source.findIndex(
    (message) => message.messageRef === proposal.evidenceMessageRef,
  );

  if (index < 0) {
    return clone(source.slice(-fallbackCount));
  }

  return clone(
    source.slice(
      Math.max(0, index - radius),
      Math.min(source.length, index + radius + 1),
    ),
  );
}

export function repairedProposalIsGrounded(proposal, messages) {
  const inspected = inspectProposalPayload(proposal);

  if (!inspected.complete) {
    return false;
  }

  const source = Array.isArray(messages) ? messages : [];
  const refs = new Set(source.map((message) => message.messageRef));

  if (
    inspected.proposal.evidenceMessageRef &&
    !refs.has(inspected.proposal.evidenceMessageRef)
  ) {
    return false;
  }

  const labels = proposalGroundingLabel(inspected.proposal)
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);

  if (labels.length === 0) {
    return true;
  }

  const sourceText = source
    .map((message) => String(message.content ?? ''))
    .join('\n');

  return labels.every((label) => sourceText.includes(label));
}

function proposalFromReviewItem(item) {
  return Object.fromEntries(
    Object.entries(item).filter(([key]) => !INTERNAL_REVIEW_KEYS.has(key)),
  );
}

export function analysisResultFromBatch(batch) {
  const result = createEmptyAnalysisResult();

  for (const item of [
    ...(batch?.detectedChanges ?? []),
    ...(batch?.uncertainItems ?? []),
  ]) {
    const proposal = proposalFromReviewItem(item);
    const bucket =
      item.uncertain || item.originBucket === 'uncertainItems'
        ? 'uncertainItems'
        : ANALYSIS_CHANGE_BUCKETS.includes(item.originBucket)
          ? item.originBucket
          : KIND_BUCKET[proposal.kind] ?? 'uncertainItems';

    result[bucket].push(proposal);
  }

  result.evidence = clone(batch?.evidence ?? []);
  return assertAnalysisResult(result);
}
