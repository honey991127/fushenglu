import { normalizeCandidate } from './candidate-normalizer.f9130cb34bf7.js';
import { resolveIdentity } from './history-consolidation.bbbff84b6958.js';
import { classifyCandidate } from './semantic-classifier.412582037586.js';

const BUCKETS = ['storyTimeChanges','inventoryChanges','currencyChanges','wardrobeChanges','skillChanges','cultivationChanges','personChanges','placeChanges','evaluationChanges','uncertainItems'];

function text(value) { return typeof value === 'string' ? value.trim().slice(0, 120) : ''; }

function isolatedCandidate(raw, index, error) {
  const evidence = raw?.evidence ?? {};
  const modelOperation = text(raw?.operation ?? raw?.action);
  const modelKind = text(raw?.kind) || 'unknown';
  const quote = text(evidence.quote ?? raw?.evidenceQuote ?? raw?.reason) || '模型候選缺少可用證據。';
  const messageRef = text(evidence.messageRef ?? raw?.evidenceMessageRef) || `isolated:${index}`;
  const reasonCode = /operation is not supported/.test(error.message)
    ? 'unsupported_operation'
    : 'candidate_validation_failed';
  return {
    schemaVersion: 1,
    kind: 'other',
    operation: 'record',
    modelOperation,
    subjectRef: { entityId: null, rawName: null, role: null },
    value: { name: modelKind, validationReason: reasonCode },
    normalizedValue: { name: modelKind, validationReason: reasonCode },
    timelineContext: 'main',
    evidence: { messageRef, messageIndex: Number.isInteger(evidence.messageIndex) ? evidence.messageIndex : index, speakerName: text(evidence.speakerName ?? raw?.speakerName) || null, quote, evidenceOrder: Number.isInteger(evidence.evidenceOrder ?? raw?.evidenceOrder) ? Number(evidence.evidenceOrder ?? raw?.evidenceOrder) : index },
    confidence: 0,
    modelUncertain: true,
    modelProposalId: text(raw?.proposalId ?? raw?.id) || `isolated_${index}`,
    disposition: 'pending',
    reasonCode,
    factKey: `isolated:${modelKind}:${modelOperation || 'missing'}:${messageRef}`,
    requiresPlayerDecision: true,
  };
}

export function applyAnalysisPolicy(analysis, state, { identityContext = null } = {}) {
  const output = [];
  let index = 0;
  for (const bucket of BUCKETS) {
    for (const raw of analysis[bucket] ?? []) {
      try {
        const candidate = normalizeCandidate(raw, { index });
        const identity = resolveIdentity(candidate.subjectRef, identityContext ?? {}, state.worldRules);
        const resolved = identity.entityId ? { ...candidate, subjectRef: { ...candidate.subjectRef, entityId: identity.entityId, rawName: candidate.subjectRef.rawName ?? identity.canonicalName } } : candidate;
        output.push({ ...classifyCandidate(resolved, { state }), originBucket: bucket });
      } catch (error) {
        output.push({ ...isolatedCandidate(raw, index, error instanceof Error ? error : new Error(String(error))), originBucket: bucket });
      }
      index += 1;
    }
  }
  return output;
}
