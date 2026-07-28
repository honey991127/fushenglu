import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ANALYSIS_CHANGE_BUCKETS,
  AnalysisSchemaError,
  parseAndValidateAnalysis,
} from '../src/core/analysis-schema.js';

test('缺少的空分類會安全補齊', () => {
  const result = parseAndValidateAnalysis(
    JSON.stringify({
      schemaVersion: 1,
      currencyChanges: [],
    }),
  );

  assert.equal(result.schemaVersion, 1);
  for (const bucket of ANALYSIS_CHANGE_BUCKETS) {
    assert.deepEqual(result[bucket], []);
  }
  assert.deepEqual(result.uncertainItems, []);
  assert.deepEqual(result.evidence, []);
});

test('可兼容 result wrapper 與 snake_case 鍵名', () => {
  const result = parseAndValidateAnalysis(
    JSON.stringify({
      result: {
        schema_version: 1,
        story_time_changes: [],
        inventory_changes: [],
        currency_changes: [],
        wardrobe_changes: [],
        skill_changes: [],
        cultivation_changes: [],
        person_changes: [],
        place_changes: [],
        evaluation_changes: [],
        uncertain_items: [],
        evidences: [],
      },
    }),
  );

  assert.equal(result.schemaVersion, 1);
  assert.deepEqual(result.storyTimeChanges, []);
  assert.deepEqual(result.uncertainItems, []);
  assert.deepEqual(result.evidence, []);
});

test('無關物件仍會拒絕，不會靜默當成空分析', () => {
  assert.throws(
    () => parseAndValidateAnalysis(JSON.stringify({ message: 'done' })),
    AnalysisSchemaError,
  );
});