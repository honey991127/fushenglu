import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  dirname,
  relative,
  resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildConfig } from '../build.config.mjs';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
);
const distributionRoot = resolve(repositoryRoot, buildConfig.outputDirectory);

function repositoryPath(path) {
  return relative(repositoryRoot, path).replaceAll('\\', '/');
}

const staticImportPattern =
  /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+\.js)['"]/g;
const dynamicImportPattern =
  /\bimport\s*\(\s*['"]([^'"]+\.js)['"]\s*\)/g;

function localDependencies(source) {
  const dependencies = [];

  for (const match of source.matchAll(staticImportPattern)) {
    dependencies.push(match[1]);
  }

  for (const match of source.matchAll(dynamicImportPattern)) {
    dependencies.push(match[1]);
  }

  return dependencies.filter((specifier) => specifier.startsWith('.'));
}

async function runtimeClosure(entryPath) {
  const result = new Set();
  const queue = [resolve(repositoryRoot, entryPath)];

  while (queue.length > 0) {
    const current = queue.shift();
    const currentRelative = repositoryPath(current);

    if (result.has(currentRelative)) {
      continue;
    }

    const source = await readFile(current, 'utf8');
    result.add(currentRelative);

    assert.doesNotMatch(
      source,
      /(?:from\s+|import\s*\()\s*['"]node:/,
    );
    assert.doesNotMatch(source, /\brequire\s*\(/);
    assert.doesNotMatch(
      source,
      /\bprocess\.(?:env|cwd|versions)\b/,
    );

    for (const specifier of localDependencies(source)) {
      const dependency = resolve(dirname(current), specifier);
      const dependencyRelative = repositoryPath(dependency);

      assert.equal(
        dependencyRelative.startsWith('src/'),
        true,
        `Runtime import escapes src: ${currentRelative} -> ${specifier}`,
      );
      queue.push(dependency);
    }
  }

  return [...result].sort();
}

test(
  'build config contains exactly the manifest runtime dependency closure',
  async () => {
    const manifest = JSON.parse(
      await readFile(
        resolve(repositoryRoot, 'manifest.json'),
        'utf8',
      ),
    );
    const expectedRuntime = await runtimeClosure(manifest.js);
    const configuredRuntime = buildConfig.files
      .filter(
        (path) =>
          path.startsWith('src/') &&
          path.endsWith('.js'),
      )
      .sort();

    assert.deepEqual(configuredRuntime, expectedRuntime);
    assert.equal(buildConfig.files.includes(manifest.js), true);

    if (manifest.css) {
      assert.equal(buildConfig.files.includes(manifest.css), true);
    }

    assert.equal(
      configuredRuntime.every(
        (path) => path.endsWith('.v042.js'),
      ),
      true,
      'The 0.4.2 dist must contain only versioned runtime JavaScript.',
    );
  },
);

test('version module is generated from manifest.json and used by both UI sources', async () => {
  const manifest = JSON.parse(
    await readFile(resolve(repositoryRoot, 'manifest.json'), 'utf8'),
  );
  const versionModule = await readFile(
    resolve(repositoryRoot, 'src/generated/version.v042.js'),
    'utf8',
  );
  const buildScript = await readFile(
    resolve(repositoryRoot, 'scripts/build.mjs'),
    'utf8',
  );

  assert.match(
    versionModule,
    new RegExp(`export const APP_VERSION = ${JSON.stringify(manifest.version)};`),
  );
  assert.match(buildScript, /readFile\(manifestPath, 'utf8'\)/);
  assert.match(buildScript, /writeFile\(versionModulePath, versionModuleSource, 'utf8'\)/);
  assert.equal(buildConfig.files.includes('src/generated/version.v042.js'), true);

  for (const appPath of ['src/ui/app.js', 'src/ui/app.v042.js']) {
    const appSource = await readFile(resolve(repositoryRoot, appPath), 'utf8');

    assert.match(appSource, /from '\.\.\/generated\/version\.v042\.js';/);
    assert.match(appSource, /浮生錄 <span class="fushenglu-version">· v\$\{APP_VERSION\}<\/span>/);
    assert.match(appSource, /API 設定/);
    assert.match(appSource, /v\$\{APP_VERSION\}/);
    assert.doesNotMatch(appSource, /const APP_VERSION\s*=\s*['"]/);
    assert.doesNotMatch(appSource, /['"]0\.4\.2['"]/);
  }
});

test('dist contains the complete versioned runtime closure including the version module', async () => {
  const manifest = JSON.parse(
    await readFile(resolve(repositoryRoot, 'manifest.json'), 'utf8'),
  );
  const expectedRuntime = await runtimeClosure(manifest.js);

  for (const relativePath of expectedRuntime) {
    const distributedSource = await readFile(
      resolve(distributionRoot, relativePath),
      'utf8',
    );

    assert.doesNotMatch(distributedSource, /(?:from\s+|import\s*\()\s*['"]node:/);
    assert.doesNotMatch(distributedSource, /\brequire\s*\(/);
  }

  const distributedVersionModule = await readFile(
    resolve(distributionRoot, 'src/generated/version.v042.js'),
    'utf8',
  );
  assert.match(
    distributedVersionModule,
    new RegExp(`export const APP_VERSION = ${JSON.stringify(manifest.version)};`),
  );
});
