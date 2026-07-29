$ErrorActionPreference = "Stop"
$project = Split-Path -Parent $MyInvocation.MyCommand.Path
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Read-Utf8([string]$path) {
    return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
}

function Write-Utf8NoBom([string]$path, [string]$content) {
    [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

function Replace-Exact(
    [string]$path,
    [string]$old,
    [string]$new,
    [string]$description
) {
    $content = Read-Utf8 $path

    if ($content.Contains($new)) {
        Write-Host "已存在，略過：" $description
        return
    }

    if (-not $content.Contains($old)) {
        throw "找不到預期程式碼：$description`n檔案：$path"
    }

    $content = $content.Replace($old, $new)
    Write-Utf8NoBom $path $content
    Write-Host "已修正：" $description
}

$apiPath = Join-Path $project "src\core\api-client.js"
$turnPath = Join-Path $project "src\core\turn-sync.js"
$appPath = Join-Path $project "src\ui\app.js"
$repairPath = Join-Path $project "src\core\proposal-repair.js"

foreach ($path in @($apiPath, $turnPath, $appPath)) {
    if (-not (Test-Path $path)) {
        throw "找不到 $path。請把本補丁放在 fushenglu 根目錄。"
    }
}

$repairContent = Get-Content -LiteralPath (Join-Path $PSScriptRoot "proposal-repair.js") -Raw -Encoding UTF8
Write-Utf8NoBom $repairPath $repairContent
Write-Host "已建立：src/core/proposal-repair.js"

# ── api-client.js：匯入修復工具 ─────────────────────────────────────
$old = @'
import {
  FLAT_STORY_ANALYSIS_JSON_SCHEMA,
  parseAndConvertFlatAnalysis,
} from './flat-analysis.js';
'@

$new = @'
import {
  FLAT_STORY_ANALYSIS_JSON_SCHEMA,
  parseAndConvertFlatAnalysis,
} from './flat-analysis.js';
import {
  flattenAnalysisProposals,
  inspectProposalPayload,
  listIncompleteProposals,
  markProposalUnresolved,
  normalizeAnalysisPayloads,
  repairedProposalIsGrounded,
  replaceAnalysisProposal,
  selectRelevantMessages,
} from './proposal-repair.js';
'@

Replace-Exact $apiPath $old $new "API 客戶端匯入單筆上下文修復工具"

# 強化主分析提示，不允許套用其他世界或常見名稱
$api = Read-Utf8 $apiPath
$oldPromptLine = '所有權含糊、突破、新技能、新人物、新地點或衝突請降低 confidence 或標 major/critical。'
$newPromptLine = @'
所有權含糊、突破、新技能、新人物、新地點或衝突請降低 confidence 或標 major/critical。
name、stage、status 等名稱必須逐字沿用本次輸入聊天中出現的原文；不得翻譯、改寫、泛化，
不得使用其他聊天、其他角色卡、常見世界觀或模型記憶補造名稱。
'@.TrimEnd()

if ($api.Contains($oldPromptLine) -and -not $api.Contains('不得使用其他聊天')) {
    $api = $api.Replace($oldPromptLine, $newPromptLine)
    Write-Utf8NoBom $apiPath $api
    Write-Host "已修正：分析提示限定當前聊天原文"
}

# 加入單筆修復提示
$old = @'
export class OpenAICompatibleClient {
'@

$new = @'
const SINGLE_PROPOSAL_REPAIR_SYSTEM_PROMPT = `
你是浮生錄的單筆資料修復器。你只能根據本次提供的 currentChatMessages 修復一筆候選。
只輸出 {"schemaVersion":1,"changes":[]}；changes 最多一項。
規則：
1. 不得使用其他聊天、其他角色卡、常見世界觀或模型記憶。
2. 物品、貨幣、技能、境界、衣物與狀態名稱必須逐字出現在 currentChatMessages。
3. 不得翻譯、改名、概括或補造名稱。
4. evidenceMessageRef 必須使用 currentChatMessages 裡實際存在的 messageRef。
5. 原文不足以確定時回傳空 changes，不要猜。
6. 保持原候選的事實方向，只修補缺失或格式錯誤的欄位。
`.trim();

export class OpenAICompatibleClient {
'@

Replace-Exact $apiPath $old $new "加入只讀當前聊天的單筆修復提示"

# 插入 repairIncompleteAnalysis 方法
$old = @'
  async analyzeMessages(messages, { batchId } = {}) {
'@

$new = @'
  async repairIncompleteAnalysis(result, messages, { batchId } = {}) {
    let working = normalizeAnalysisPayloads(result);
    const incomplete = listIncompleteProposals(working);

    for (const item of incomplete) {
      const relevantMessages = selectRelevantMessages(
        messages,
        item.proposal,
      );
      let replacement = null;

      try {
        const repairContent = await this.request(
          'analysis',
          [
            {
              role: 'system',
              content: SINGLE_PROPOSAL_REPAIR_SYSTEM_PROMPT,
            },
            {
              role: 'user',
              content: JSON.stringify({
                schemaVersion: 1,
                batchId,
                incompleteCandidate: item.proposal,
                detectedIssues: item.issues,
                currentChatMessages: relevantMessages,
              }),
            },
          ],
          {
            jsonSchema: FLAT_STORY_ANALYSIS_JSON_SCHEMA,
            maxOutputTokens: 768,
            temperature: 0,
          },
        );
        const repairResult = parseAndConvertFlatAnalysis(repairContent);
        const candidates = flattenAnalysisProposals(repairResult);
        const candidate =
          candidates.find(
            (proposal) => proposal.kind === item.proposal.kind,
          ) ?? null;

        if (candidate) {
          const inspected = inspectProposalPayload({
            ...candidate,
            proposalId: item.proposal.proposalId,
            dedupeKey: item.proposal.dedupeKey,
          });

          if (
            inspected.complete &&
            repairedProposalIsGrounded(
              inspected.proposal,
              relevantMessages,
            )
          ) {
            replacement = {
              ...inspected.proposal,
              proposalId: item.proposal.proposalId,
              dedupeKey: item.proposal.dedupeKey,
              repairStatus: 'repaired_from_current_chat',
            };
          }
        }
      } catch (error) {
        this.logger.warn('單筆候選自動修復失敗，改送待確認', {
          batchId,
          proposalId: item.proposal.proposalId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      working = replacement
        ? replaceAnalysisProposal(
            working,
            item.proposal.proposalId,
            replacement,
          )
        : markProposalUnresolved(working, item);
    }

    return working;
  }

  async analyzeMessages(messages, { batchId } = {}) {
'@

Replace-Exact $apiPath $old $new "加入逐筆 AI 上下文修復"

# 初次分析／格式修復後執行語意欄位修復
$api = Read-Utf8 $apiPath
$old = @'
      result = parseAndConvertFlatAnalysis(repairedContent);
    }

    const settings = this.settingsStore.load();
'@

$new = @'
      result = parseAndConvertFlatAnalysis(repairedContent);
    }

    result = await this.repairIncompleteAnalysis(
      result,
      messages,
      { batchId },
    );

    const settings = this.settingsStore.load();
'@

if ($api.Contains($old)) {
    $api = $api.Replace($old, $new)
    Write-Utf8NoBom $apiPath $api
    Write-Host "已修正：分析完成後自動修復缺欄位候選"
} elseif (-not $api.Contains('result = await this.repairIncompleteAnalysis')) {
    throw "找不到 analyzeMessages 的解析完成區塊。"
}

# 自然語言修正也走同一套上下文修復
$api = Read-Utf8 $apiPath
$old = @'
    return parseAndConvertFlatAnalysis(content);
  }
}
'@

$new = @'
    const result = parseAndConvertFlatAnalysis(content);

    return this.repairIncompleteAnalysis(
      result,
      [
        {
          messageRef: `correction:${batchId}`,
          role: 'user',
          content: text,
        },
      ],
      { batchId },
    );
  }
}
'@

if ($api.Contains($old)) {
    $api = $api.Replace($old, $new)
    Write-Utf8NoBom $apiPath $api
    Write-Host "已修正：玩家自然語言修正也會逐筆補全"
} elseif (-not $api.Contains('messageRef: `correction:${batchId}`')) {
    throw "找不到 parseCorrection 結尾。"
}

# ── turn-sync.js：現有批次可刷新預覽，提交時有最後防護 ───────────────
$turn = Read-Utf8 $turnPath

if (-not $turn.Contains("from './proposal-repair.js'")) {
    $old = @'
} from './character-state.js';

export const BATCH_STATUSES = Object.freeze([
'@

    $new = @'
} from './character-state.js';
import {
  inspectProposalPayload,
} from './proposal-repair.js';

export const BATCH_STATUSES = Object.freeze([
'@

    if ($turn.Contains($old)) {
        $turn = $turn.Replace($old, $new)
        Write-Utf8NoBom $turnPath $turn
        Write-Host "已修正：提交層匯入候選完整性檢查"
    } elseif ($turn.Contains("from './proposal-payload.js'")) {
        $needle = "import { normalizeProposalPayload } from './proposal-payload.js';"
        $replacement = @'
import { normalizeProposalPayload } from './proposal-payload.js';
import { inspectProposalPayload } from './proposal-repair.js';
'@
        $turn = $turn.Replace($needle, $replacement)
        Write-Utf8NoBom $turnPath $turn
        Write-Host "已修正：兼容 0.3.5 並匯入候選完整性檢查"
    } else {
        throw "找不到 turn-sync.js 的匯入位置。"
    }
}

# 加入 refreshBatchAnalysis
$old = @'
export function failBatch(
'@

$new = @'
export function refreshBatchAnalysis(
  state,
  batchId,
  result,
  timestamp = new Date().toISOString(),
) {
  const analysis = assertAnalysisResult(result);
  const batch = requireBatch(state, batchId);

  if (batch.status !== 'review_ready') {
    throw new Error('只有 review_ready 批次可以刷新分析預覽');
  }

  const previousItems = new Map(
    [...batch.detectedChanges, ...batch.uncertainItems].map((item) => [
      item.proposalId,
      item,
    ]),
  );
  const previousDrafts = new Map(
    batch.handoffDrafts.map((draft) => [draft.draftId, draft]),
  );
  const preserveReview = (item) => {
    const previous = previousItems.get(item.proposalId);

    if (!previous) {
      return item;
    }

    return {
      ...item,
      reviewDisposition:
        item.uncertain && previous.reviewDisposition !== 'reject'
          ? 'pending'
          : previous.reviewDisposition,
      editedByPlayer: previous.editedByPlayer,
    };
  };
  const detectedChanges = ANALYSIS_CHANGE_BUCKETS.flatMap((bucket) =>
    analysis[bucket].map((proposal) =>
      preserveReview(createReviewItem(proposal, bucket, false)),
    ),
  );
  const uncertainItems = analysis.uncertainItems.map((proposal) =>
    preserveReview(
      createReviewItem(proposal, 'uncertainItems', true),
    ),
  );
  const handoffDrafts = [
    ...[...detectedChanges, ...uncertainItems].map((item) => {
      const fresh = handoffDraftFor(item);
      const previous = previousDrafts.get(fresh.draftId);

      return previous
        ? {
            ...fresh,
            text: previous.text,
            mode: previous.mode,
            active:
              fresh.active &&
              previous.active &&
              previous.mode !== 'never',
          }
        : fresh;
    }),
    ...batch.draftActions.map((action) => handoffDraftFor(action, 'action')),
  ];
  const refreshed = {
    ...batch,
    detectedChanges,
    uncertainItems,
    evidence: clone(analysis.evidence),
    handoffDrafts,
    updatedAt: requireTimestamp(timestamp),
  };

  return stateWithTimestamp(
    replaceBatch(state, refreshed),
    timestamp,
  );
}

export function failBatch(
'@

Replace-Exact $turnPath $old $new "加入現有批次分析預覽刷新"

# 0.3.4 提交循環：無效玩家操作轉待確認
$turn = Read-Utf8 $turnPath
$oldActionLoop = @'
  for (const action of batch.draftActions) {
    if (!action.selected) {
      continue;
    }

    if (existingDedupeKeys.has(action.dedupeKey)) {
      continue;
    }

    if (actionRequiresPending(state, action)) {
      const pendingId = createId('pending');
      newPending.push(pendingFromProposal(batch, action, pendingId, timestamp));
      pendingItemIds.push(pendingId);
      continue;
    }

    const event = sourceEvent(
      batch,
      action,
      createId('event'),
      timestamp,
      'plugin_action',
    );
    newEvents.push(event);
    newRecords.push(testRecordForEvent(event, createId('record'), timestamp));
    existingDedupeKeys.add(action.dedupeKey);
  }
'@

$newActionLoop = @'
  for (const action of batch.draftActions) {
    if (!action.selected) {
      continue;
    }

    const inspected = inspectProposalPayload(action);
    const commitAction = {
      ...action,
      ...inspected.proposal,
      payloadIssues: [...inspected.issues],
    };

    if (existingDedupeKeys.has(commitAction.dedupeKey)) {
      continue;
    }

    if (!inspected.complete || actionRequiresPending(state, commitAction)) {
      const pendingId = createId('pending');
      newPending.push(
        pendingFromProposal(batch, commitAction, pendingId, timestamp),
      );
      pendingItemIds.push(pendingId);
      continue;
    }

    const event = sourceEvent(
      batch,
      commitAction,
      createId('event'),
      timestamp,
      'plugin_action',
    );
    newEvents.push(event);
    newRecords.push(testRecordForEvent(event, createId('record'), timestamp));
    existingDedupeKeys.add(commitAction.dedupeKey);
  }
'@

if ($turn.Contains($oldActionLoop)) {
    $turn = $turn.Replace($oldActionLoop, $newActionLoop)
    Write-Utf8NoBom $turnPath $turn
    Write-Host "已修正：玩家操作提交前完整性防護"
}

# 0.3.4 提交循環：無效 AI 候選轉待確認
$turn = Read-Utf8 $turnPath
$oldItemLoop = @'
  for (const item of allReviewItems) {
    if (item.reviewDisposition === 'reject') {
      rejectedProposalIds.push(item.proposalId);
      continue;
    }

    if (item.reviewDisposition === 'pending') {
      const pendingId = createId('pending');
      newPending.push(pendingFromProposal(batch, item, pendingId, timestamp));
      pendingItemIds.push(pendingId);
      continue;
    }

    if (existingDedupeKeys.has(item.dedupeKey)) {
      rejectedProposalIds.push(item.proposalId);
      continue;
    }

    const event = sourceEvent(batch, item, createId('event'), timestamp);
    newEvents.push(event);
    newRecords.push(testRecordForEvent(event, createId('record'), timestamp));
    acceptedProposalIds.push(item.proposalId);
    existingDedupeKeys.add(item.dedupeKey);
  }
'@

$newItemLoop = @'
  for (const item of allReviewItems) {
    if (item.reviewDisposition === 'reject') {
      rejectedProposalIds.push(item.proposalId);
      continue;
    }

    const inspected = inspectProposalPayload(item);
    const commitItem = {
      ...item,
      ...inspected.proposal,
      payloadIssues: [...inspected.issues],
    };

    if (item.reviewDisposition === 'pending' || !inspected.complete) {
      const pendingId = createId('pending');
      newPending.push(
        pendingFromProposal(batch, commitItem, pendingId, timestamp),
      );
      pendingItemIds.push(pendingId);
      continue;
    }

    if (existingDedupeKeys.has(commitItem.dedupeKey)) {
      rejectedProposalIds.push(commitItem.proposalId);
      continue;
    }

    const event = sourceEvent(batch, commitItem, createId('event'), timestamp);
    newEvents.push(event);
    newRecords.push(testRecordForEvent(event, createId('record'), timestamp));
    acceptedProposalIds.push(commitItem.proposalId);
    existingDedupeKeys.add(commitItem.dedupeKey);
  }
'@

if ($turn.Contains($oldItemLoop)) {
    $turn = $turn.Replace($oldItemLoop, $newItemLoop)
    Write-Utf8NoBom $turnPath $turn
    Write-Host "已修正：AI 候選提交前完整性防護"
} elseif (
    -not $turn.Contains('prepareProposalPayload(item)') -and
    -not $turn.Contains('inspectProposalPayload(item)')
) {
    throw "找不到 AI 候選提交循環，且沒有既有防護。"
}

# ── app.js：最終確認前修復既有 20 段批次 ───────────────────────────
$app = Read-Utf8 $appPath

if (-not $app.Contains("from '../core/proposal-repair.js'")) {
    $old = @'
import { createCharacterAction } from '../core/character-state.js';
'@

    $new = @'
import { createCharacterAction } from '../core/character-state.js';
import {
  analysisResultFromBatch,
  listIncompleteProposals,
} from '../core/proposal-repair.js';
'@

    if (-not $app.Contains($old)) {
        throw "找不到 app.js 的 character-state 匯入。"
    }

    $app = $app.Replace($old, $new)
    Write-Utf8NoBom $appPath $app
    Write-Host "已修正：介面匯入既有批次修復工具"
}

$app = Read-Utf8 $appPath
if (-not $app.Contains('refreshBatchAnalysis,')) {
    $old = @'
  recoverCertainActionsOnly,
  resolvePendingItem,
'@

    $new = @'
  recoverCertainActionsOnly,
  refreshBatchAnalysis,
  resolvePendingItem,
'@

    if (-not $app.Contains($old)) {
        throw "找不到 app.js 的 turn-sync 匯入位置。"
    }

    $app = $app.Replace($old, $new)
    Write-Utf8NoBom $appPath $app
    Write-Host "已修正：介面匯入預覽刷新"
}

$old = @'
  async function finishCommit(batchId, startFromReview = true) {
    if (startFromReview) {
      await store.update((current) => startBatchCommit(current, batchId, now()));
    }

    let snapshot = await store.read();
'@

$new = @'
  async function finishCommit(batchId, startFromReview = true) {
    let beforeCommit = await store.read();
    let reviewBatch = getBatch(beforeCommit.state, batchId);

    if (reviewBatch?.status === 'review_ready') {
      const currentAnalysis = analysisResultFromBatch(reviewBatch);
      const incomplete = listIncompleteProposals(currentAnalysis);

      if (incomplete.length > 0) {
        setStatus(
          `正在依本聊天原文修復 ${incomplete.length} 筆不完整候選…`,
          'neutral',
        );
        const repaired = await apiClient.repairIncompleteAnalysis(
          currentAnalysis,
          reviewBatch.inputMessages.map(
            ({ messageRef, role, content }) => ({
              messageRef,
              role,
              content,
            }),
          ),
          { batchId: `${batchId}:precommit` },
        );

        await store.update((current) =>
          refreshBatchAnalysis(
            current,
            batchId,
            repaired,
            now(),
          ),
        );
      }
    }

    if (startFromReview) {
      await store.update((current) => startBatchCommit(current, batchId, now()));
    }

    let snapshot = await store.read();
'@

Replace-Exact $appPath $old $new "最終確認前只修復缺欄位候選"

# ── 測試 ─────────────────────────────────────────────────────────────
$testPath = Join-Path $project "tests\proposal-repair-context.test.js"
$testContent = @'
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BrowserApiSettingsStore,
  OpenAICompatibleClient,
} from '../src/core/api-client.js';
import { createEmptyAnalysisResult } from '../src/core/analysis-schema.js';
import {
  inspectProposalPayload,
  repairedProposalIsGrounded,
} from '../src/core/proposal-repair.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

function settingsStore() {
  const store = new BrowserApiSettingsStore({
    storage: memoryStorage(),
  });
  store.save({
    schemaVersion: 1,
    baseUrl: 'https://api.example.test/v1',
    apiKey: 'test-key',
    analysisModel: 'analysis-model',
    generationModel: 'generation-model',
    validationModel: '',
    temperature: 0.2,
    maxOutputTokens: 2048,
  });
  return store;
}

function response(content) {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        choices: [{ message: { content } }],
      };
    },
  };
}

test('任意世界觀的原文名稱都可通過，不依賴固定詞庫', () => {
  for (const name of [
    '量子門禁憑證',
    '員工識別證',
    '月影長弓',
    'NX-47 維修模組',
  ]) {
    const inspected = inspectProposalPayload({
      proposalId: `proposal-${name}`,
      kind: 'inventory',
      operation: 'add',
      value: { name, quantity: 1 },
      confidence: 0.9,
      evidenceMessageRef: 'message:1',
      reason: '原文明確取得',
      severity: 'minor',
      dedupeKey: `inventory:${name}`,
    });

    assert.equal(inspected.complete, true);
  }
});

test('修復名稱必須逐字存在於目前聊天，不可從其他世界補造', () => {
  const candidate = {
    proposalId: 'proposal-1',
    kind: 'inventory',
    operation: 'add',
    value: { name: '量子鑰匙', quantity: 1 },
    confidence: 0.9,
    evidenceMessageRef: 'message:1',
    reason: '原文取得',
    severity: 'minor',
    dedupeKey: 'inventory:key',
  };

  assert.equal(
    repairedProposalIsGrounded(candidate, [
      {
        messageRef: 'message:1',
        role: 'assistant',
        content: '他把量子鑰匙交到你手中。',
      },
    ]),
    true,
  );
  assert.equal(
    repairedProposalIsGrounded(candidate, [
      {
        messageRef: 'message:1',
        role: 'assistant',
        content: '他交給你一件未說明名稱的物品。',
      },
    ]),
    false,
  );
});

test('缺少名稱時 AI 只根據當前聊天逐筆修復', async () => {
  let calls = 0;
  const client = new OpenAICompatibleClient({
    settingsStore: settingsStore(),
    logger: { warn() {}, error() {}, info() {} },
    fetchImpl: async () => {
      calls += 1;

      if (calls === 1) {
        return response(JSON.stringify({
          schemaVersion: 1,
          changes: [{
            kind: 'inventory',
            operation: 'add',
            value: { quantity: 1 },
            evidenceMessageRef: 'message:1',
            confidence: 0.9,
            reason: '取得一件物品',
            severity: 'minor',
            dedupeKey: 'inventory:unknown',
          }],
        }));
      }

      return response(JSON.stringify({
        schemaVersion: 1,
        changes: [{
          kind: 'inventory',
          operation: 'add',
          value: {
            name: 'NX-47 維修模組',
            quantity: 1,
          },
          evidenceMessageRef: 'message:1',
          confidence: 0.95,
          reason: '名稱逐字出現在原文',
          severity: 'minor',
          dedupeKey: 'ignored-by-repair',
        }],
      }));
    },
  });

  const result = await client.analyzeMessages(
    [{
      messageRef: 'message:1',
      role: 'assistant',
      content: '你取得了 NX-47 維修模組。',
    }],
    { batchId: 'batch-context-repair' },
  );

  assert.equal(calls, 2);
  assert.equal(result.inventoryChanges.length, 1);
  assert.equal(
    result.inventoryChanges[0].value.name,
    'NX-47 維修模組',
  );
  assert.equal(result.uncertainItems.length, 0);
});

test('AI 無法從原文確定名稱時不猜，改送待確認且不令整批失敗', async () => {
  let calls = 0;
  const client = new OpenAICompatibleClient({
    settingsStore: settingsStore(),
    logger: { warn() {}, error() {}, info() {} },
    fetchImpl: async () => {
      calls += 1;

      if (calls === 1) {
        return response(JSON.stringify({
          schemaVersion: 1,
          changes: [{
            kind: 'inventory',
            operation: 'add',
            value: { quantity: 1 },
            evidenceMessageRef: 'message:2',
            confidence: 0.9,
            reason: '取得物品',
            severity: 'minor',
            dedupeKey: 'inventory:unnamed',
          }],
        }));
      }

      return response(JSON.stringify({
        schemaVersion: 1,
        changes: [],
      }));
    },
  });

  const result = await client.analyzeMessages(
    [{
      messageRef: 'message:2',
      role: 'assistant',
      content: '你得到一件沒有說明名稱的東西。',
    }],
    { batchId: 'batch-unresolved' },
  );

  assert.equal(calls, 2);
  assert.equal(result.inventoryChanges.length, 0);
  assert.equal(result.uncertainItems.length, 1);
  assert.equal(
    result.uncertainItems[0].repairStatus,
    'unresolved',
  );
});

test('沒有不完整候選時不增加額外 API 請求', async () => {
  let calls = 0;
  const complete = createEmptyAnalysisResult();
  complete.inventoryChanges.push({
    proposalId: 'proposal-complete',
    kind: 'inventory',
    operation: 'add',
    value: { name: '普通雨傘', quantity: 1 },
    confidence: 0.95,
    evidenceMessageRef: 'message:3',
    reason: '原文明確取得',
    severity: 'minor',
    dedupeKey: 'inventory:umbrella',
  });

  const client = new OpenAICompatibleClient({
    settingsStore: settingsStore(),
    logger: { warn() {}, error() {}, info() {} },
    fetchImpl: async () => {
      calls += 1;
      return response(JSON.stringify(complete));
    },
  });

  const result = await client.analyzeMessages(
    [{
      messageRef: 'message:3',
      role: 'assistant',
      content: '你拿起普通雨傘。',
    }],
    { batchId: 'batch-no-extra-call' },
  );

  assert.equal(calls, 1);
  assert.equal(result.inventoryChanges.length, 1);
});
'@

Write-Utf8NoBom $testPath $testContent
Write-Host "已新增測試：tests/proposal-repair-context.test.js"

# ── 版本與檢查 ───────────────────────────────────────────────────────
$packagePath = Join-Path $project "package.json"
$manifestPath = Join-Path $project "manifest.json"

foreach ($path in @($packagePath, $manifestPath)) {
    $content = Read-Utf8 $path
    $content = [regex]::Replace(
        $content,
        '"version"\s*:\s*"0\.3\.[45]"',
        '"version": "0.3.6"',
        1
    )
    Write-Utf8NoBom $path $content
    Write-Host "已更新版本：" $path
}

$package = Read-Utf8 $packagePath

if (-not $package.Contains("node --check src/core/proposal-repair.js")) {
    $needle = "node --check src/core/flat-analysis.js &&"

    if (-not $package.Contains($needle)) {
        throw "找不到 package.json 的 flat-analysis 語法檢查。"
    }

    $package = $package.Replace(
        $needle,
        "node --check src/core/proposal-repair.js && node --check src/core/flat-analysis.js &&"
    )
    Write-Utf8NoBom $packagePath $package
}

$testFiles = Get-ChildItem -LiteralPath (Join-Path $project "tests") -Filter "*.test.js" -File
foreach ($file in $testFiles) {
    $content = Read-Utf8 $file.FullName
    $updated = $content.Replace("0.3.4", "0.3.6").Replace("0.3.5", "0.3.6")

    if ($updated -ne $content) {
        Write-Utf8NoBom $file.FullName $updated
    }
}

$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) {
    throw "找不到 npm.cmd，無法執行驗證。"
}

Push-Location $project
try {
    Write-Host ""
    Write-Host "正在執行 npm run verify..."
    & npm.cmd run verify

    if ($LASTEXITCODE -ne 0) {
        throw "npm run verify 失敗，退出碼 $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}

Write-Host ""
Write-Host "浮生錄 0.3.6 當前聊天單筆自動修復完成。"
Write-Host "請上傳 src、tests、dist、package.json、manifest.json。"
