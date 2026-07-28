import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createEmptyAnalysisResult,
  mergeAnalysisResults,
  splitAnalysisMessages,
} from '../src/core/analysis-schema.js';

function proposal({
  proposalId,
  dedupeKey,
  messageRef,
  name,
}) {
  return {
    proposalId,
    kind: 'inventory',
    operation: 'add',
    value: { name, quantity: 1 },
    confidence: 0.95,
    evidenceMessageRef: messageRef,
    reason: '主線中明確取得',
    severity: 'minor',
    dedupeKey,
  };
}

test('既有聊天會依訊息數與字元上限分段', () => {
  const messages = Array.from({ length: 17 }, (_, index) => ({
    messageRef: `message:${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `第 ${index + 1} 層`,
  }));
  const chunks = splitAnalysisMessages(messages, {
    maxMessages: 8,
    maxCharacters: 9000,
  });

  assert.deepEqual(
    chunks.map((chunk) => chunk.length),
    [8, 8, 1],
  );
});

test('單一超長訊息會獨立成段且不遺失', () => {
  const messages = [
    { messageRef: 'm1', role: 'user', content: '短' },
    {
      messageRef: 'm2',
      role: 'assistant',
      content: '長'.repeat(10000),
    },
    { messageRef: 'm3', role: 'user', content: '尾' },
  ];
  const chunks = splitAnalysisMessages(messages, {
    maxMessages: 8,
    maxCharacters: 9000,
  });

  assert.equal(chunks.flat().length, 3);
  assert.equal(chunks[1][0].messageRef, 'm2');
});

test('分段分析結果可合併、去重並處理重複 proposalId', () => {
  const first = createEmptyAnalysisResult();
  first.inventoryChanges.push(
    proposal({
      proposalId: 'proposal-1',
      dedupeKey: 'inventory:a',
      messageRef: 'm1',
      name: '甲',
    }),
  );
  first.evidence.push({ messageRef: 'm1', quote: '取得甲。' });

  const second = createEmptyAnalysisResult();
  second.inventoryChanges.push(
    proposal({
      proposalId: 'proposal-1',
      dedupeKey: 'inventory:b',
      messageRef: 'm2',
      name: '乙',
    }),
    proposal({
      proposalId: 'proposal-duplicate',
      dedupeKey: 'inventory:a',
      messageRef: 'm1',
      name: '甲',
    }),
  );
  second.evidence.push(
    { messageRef: 'm1', quote: '取得甲。' },
    { messageRef: 'm2', quote: '取得乙。' },
  );

  const merged = mergeAnalysisResults([first, second]);

  assert.equal(merged.inventoryChanges.length, 2);
  assert.equal(
    new Set(
      merged.inventoryChanges.map((item) => item.proposalId),
    ).size,
    2,
  );
  assert.equal(merged.evidence.length, 2);
});

test('介面會保存分段進度並從失敗段續作', async () => {
  const source = await readFile(
    new URL('../src/ui/app.js', import.meta.url),
    'utf8',
  );

  assert.match(source, /historyImportProgress/);
  assert.match(source, /nextChunkIndex/);
  assert.match(source, /completedChunks/);
  assert.match(source, /failedChunkIndex/);
  assert.match(source, /第 \$\{chunkIndex \+ 1\}／\$\{chunks\.length\} 段/);
});