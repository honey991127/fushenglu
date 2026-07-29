import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseAndConvertFlatAnalysis,
} from '../src/core/flat-analysis.js';
import {
  validateValidationResult,
} from '../src/core/analysis-schema.js';

test('單一 changes 陣列會由插件本地分類', () => {
  const result = parseAndConvertFlatAnalysis(JSON.stringify({
    schemaVersion: 1,
    changes: [{
      kind: 'currency',
      operation: 'add',
      value: { name: '靈石', amount: 100 },
      evidenceMessageRef: 'message:1',
      evidenceQuote: '得到一百靈石',
      confidence: 0.95,
      reason: '明確取得',
      severity: 'minor',
      dedupeKey: 'currency:spirit-stone:add:100',
    }],
  }));

  assert.equal(result.currencyChanges.length, 1);
  assert.equal(result.inventoryChanges.length, 0);
  assert.equal(result.evidence.length, 1);
});

test('changes 是單一物件時也能安全包成陣列', () => {
  const result = parseAndConvertFlatAnalysis(JSON.stringify({
    changes: {
      kind: 'skill',
      operation: 'set',
      value: { name: '御劍', proficiency: 14 },
      evidenceMessageRef: 'message:2',
    },
  }));

  assert.equal(result.skillChanges.length, 1);
  assert.equal(result.skillChanges[0].confidence, 0);
  assert.equal(result.skillChanges[0].severity, 'major');
});

test('舊式多分類回應仍可相容', () => {
  const result = parseAndConvertFlatAnalysis(JSON.stringify({
    schemaVersion: 1,
    storyTimeChanges: [],
    inventoryChanges: [],
    currencyChanges: [],
    wardrobeChanges: [],
    skillChanges: [],
    cultivationChanges: [],
    personChanges: [],
    placeChanges: [],
    evaluationChanges: [],
    uncertainItems: [],
    evidence: [],
  }));

  assert.equal(result.schemaVersion, 1);
  assert.deepEqual(result.currencyChanges, []);
});

test('完全無關的物件仍會拒絕', () => {
  assert.throws(
    () => parseAndConvertFlatAnalysis('{"message":"done"}'),
    /缺少 changes/,
  );
});

test('校驗 issues 的單一文字會轉成陣列', () => {
  assert.deepEqual(
    validateValidationResult({
      schemaVersion: 1,
      valid: false,
      issues: '證據不足',
    }),
    {
      schemaVersion: 1,
      valid: false,
      issues: ['證據不足'],
    },
  );
});