import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AnalysisSchemaError,
  createEmptyAnalysisResult,
  parseAndValidateAnalysis,
  parseJsonObject,
  validateAnalysisResult,
} from '../src/core/analysis-schema.js';

function proposal(overrides = {}) {
  return {
    proposalId: 'proposal-1',
    kind: 'inventory',
    operation: 'add',
    value: { name: '測試物品', quantity: 1 },
    confidence: 0.94,
    evidenceMessageRef: 'message:m1|swipe:0|content:12345678',
    reason: '主線中明確收到',
    severity: 'minor',
    dedupeKey: 'inventory:test-item:received:m1',
    ...overrides,
  };
}

test('合法分析結果包含全部必要 bucket 並通過驗證', () => {
  const result = createEmptyAnalysisResult();
  result.inventoryChanges.push(proposal());
  result.evidence.push({
    messageRef: 'message:m1|swipe:0|content:12345678',
    quote: '你收下測試物品。',
  });

  assert.deepEqual(validateAnalysisResult(result), { ok: true, issues: [] });
  assert.deepEqual(
    parseAndValidateAnalysis(`\`\`\`json\n${JSON.stringify(result)}\n\`\`\``),
    result,
  );
});

test('storyTimeChanges 必須標示時間語境', () => {
  const result = createEmptyAnalysisResult();
  result.storyTimeChanges.push(
    proposal({
      kind: 'story_time',
      operation: 'advance',
      value: { day: 2 },
    }),
  );
  const validation = validateAnalysisResult(result);

  assert.equal(validation.ok, false);
  assert.match(validation.issues.join('；'), /timelineContext/);
});

test('任一候選不合法時整份結果拒絕，不提供部分結果', () => {
  const result = createEmptyAnalysisResult();
  result.inventoryChanges.push(proposal());
  result.currencyChanges.push(
    proposal({
      proposalId: 'proposal-2',
      kind: 'currency',
      confidence: 3,
    }),
  );

  assert.throws(
    () => parseAndValidateAnalysis(JSON.stringify(result)),
    AnalysisSchemaError,
  );
});

test('非 JSON 內容會提供可理解錯誤', () => {
  assert.throws(
    () => parseJsonObject('這不是 JSON'),
    /不是合法 JSON/,
  );
});
