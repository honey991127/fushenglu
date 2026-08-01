import { createEmptyAnalysisResult } from '../../src/core/analysis-schema.js';
import { normalizeCandidate } from '../../src/core/candidate-normalizer.js';
import { classifyCandidate } from '../../src/core/semantic-classifier.js';
import { applyAnalysisPolicy } from '../../src/core/analysis-policy.js';
import { beginTurnBatch, completeBatchAnalysis } from '../../src/core/turn-sync.js';
export function productionReviewState(state, timestamp = '2026-08-01T00:00:00.000Z') {
  const candidates = [
    { proposalId: 'time', evidenceMessageRef: 'm1', reason: '三月十八申時', severity: 'moderate', dedupeKey: 'time', kind: 'story_time', operation: 'set', subjectRef: { entityId: 'entity:player', role: 'player' }, value: { time: '三月十八申時' }, timelineContext: 'main', evidence: { messageRef: 'm1', messageIndex: 0, speakerName: '旁白', quote: '三月十八申時', evidenceOrder: 0 }, confidence: .99 },
    { proposalId: 'place', evidenceMessageRef: 'm2', reason: '你抵達藏書閣', severity: 'moderate', dedupeKey: 'place', kind: 'place', operation: 'set', subjectRef: { entityId: 'entity:player', role: 'player' }, value: { name: '藏書閣' }, timelineContext: 'main', evidence: { messageRef: 'm2', messageIndex: 1, speakerName: '旁白', quote: '你抵達藏書閣', evidenceOrder: 0 }, confidence: .99 },
    { proposalId: 'item', evidenceMessageRef: 'm3', reason: '桌上有玉佩', severity: 'moderate', dedupeKey: 'item', kind: 'inventory', operation: 'add', subjectRef: {}, value: { name: '玉佩', quantity: { text: '一枚' } }, timelineContext: 'main', evidence: { messageRef: 'm3', messageIndex: 2, speakerName: '旁白', quote: '桌上有玉佩', evidenceOrder: 0 }, confidence: .8 },
  ];
  const normalized = candidates.map((x, index) => normalizeCandidate(x, { index }));
  const classified = normalized.map((x) => classifyCandidate(x, { state }));
  const analysis = createEmptyAnalysisResult(); analysis.storyTimeChanges.push(candidates[0]); analysis.placeChanges.push(candidates[1]); analysis.inventoryChanges.push(candidates[2]);
  const started = beginTurnBatch(state, [], { batchId: 'batch:dom', timestamp, source: 'turn' }).state;
  const next = completeBatchAnalysis(started, 'batch:dom', analysis, timestamp);
  return { state: next, normalized, classified, policy: applyAnalysisPolicy(analysis, started), batch: next.batches.at(-1) };
}

