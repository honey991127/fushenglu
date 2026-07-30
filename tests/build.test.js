import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildConfig } from '../build.config.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distributionRoot = resolve(repositoryRoot, buildConfig.outputDirectory);
const staticImportPattern = /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+\.js)['"]/g;
const dynamicImportPattern = /\bimport\s*\(\s*['"]([^'"]+\.js)['"]\s*\)/g;

function repositoryPath(path) { return relative(repositoryRoot, path).replaceAll('\\', '/'); }
function localDependencies(source) {
  return [...source.matchAll(staticImportPattern), ...source.matchAll(dynamicImportPattern)]
    .map((match) => match[1])
    .filter((specifier) => specifier.startsWith('.'));
}
async function runtimeClosure(root, entryPath) {
  const result = new Set();
  const queue = [resolve(root, entryPath)];
  while (queue.length > 0) {
    const current = queue.shift();
    const currentRelative = relative(root, current).replaceAll('\\', '/');
    if (result.has(currentRelative)) continue;
    const source = await readFile(current, 'utf8');
    result.add(currentRelative);
    assert.doesNotMatch(source, /(?:from\s+|import\s*\()\s*['"]node:/);
    assert.doesNotMatch(source, /\brequire\s*\(/);
    assert.doesNotMatch(source, /\bprocess\.(?:env|cwd|versions)\b/);
    for (const specifier of localDependencies(source)) {
      const dependency = resolve(dirname(current), specifier);
      const dependencyRelative = relative(root, dependency).replaceAll('\\', '/');
      assert.equal(dependencyRelative.startsWith('src/'), true, 'Runtime import escapes src: ' + currentRelative + ' -> ' + specifier);
      queue.push(dependency);
    }
  }
  return [...result].sort();
}

test('build config contains only static distribution assets', () => {
  assert.deepEqual([...buildConfig.staticFiles].sort(), ['README.md', 'src/style.css']);
});

test('source runtime has one editable non-versioned dependency closure', async () => {
  const manifest = JSON.parse(await readFile(resolve(repositoryRoot, 'manifest.json'), 'utf8'));
  const closure = await runtimeClosure(repositoryRoot, manifest.js);
  assert.equal(manifest.js, 'src/index.js');
  assert.equal(closure.some((path) => /\.v\d+\.js$/.test(path)), false);
  const versionSource = await readFile(resolve(repositoryRoot, 'src/version.js'), 'utf8');
  assert.match(versionSource, /__FUSHENGLU_VERSION__/);
});

test('dist manifest loads the generated cache-safe runtime closure', async () => {
  const sourceManifest = JSON.parse(await readFile(resolve(repositoryRoot, 'manifest.json'), 'utf8'));
  const distManifest = JSON.parse(await readFile(resolve(distributionRoot, 'manifest.json'), 'utf8'));
  assert.equal(distManifest.version, sourceManifest.version);
  assert.notEqual(distManifest.js, sourceManifest.js);
  assert.match(distManifest.js, /^src\/index\.[a-f0-9]{12}\.js$/);
  const closure = await runtimeClosure(distributionRoot, distManifest.js);
  assert.equal(closure.length > 1, true);
  assert.equal(closure.every((path) => /\.[a-f0-9]{12}\.js$/.test(path)), true);
  const versionModule = closure.find((path) => path.startsWith('src/version.'));
  assert.ok(versionModule);
  const versionSource = await readFile(resolve(distributionRoot, versionModule), 'utf8');
  assert.match(versionSource, new RegExp("APP_VERSION = ['\"]" + sourceManifest.version + "['\"]"));
});
