import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildConfig } from '../build.config.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('所有正式前端 JavaScript 都在建置清單且不含 Node-only runtime import', async () => {
  const runtimeJavaScript = buildConfig.files.filter(
    (path) => path.startsWith('src/') && path.endsWith('.js'),
  );

  assert.deepEqual(
    [...runtimeJavaScript].sort(),
    [
      'src/core/analysis-schema.js',
      'src/core/api-client.js',
      'src/core/chat-state.js',
      'src/core/character-state.js',
      'src/core/turn-sync.js',
      'src/index.js',
      'src/integrations/tauritavern.js',
      'src/ui/app.js',
    ].sort(),
  );

  for (const relativePath of runtimeJavaScript) {
    const source = await readFile(resolve(repositoryRoot, relativePath), 'utf8');
    assert.doesNotMatch(source, /(?:from\s+|import\s*\()\s*['"]node:/);
    assert.doesNotMatch(source, /\brequire\s*\(/);
    assert.doesNotMatch(source, /\bprocess\.(?:env|cwd|versions)\b/);
  }
});
