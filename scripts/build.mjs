import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildConfig } from '../build.config.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = resolve(repositoryRoot, buildConfig.outputDirectory);

function assertInsideRepository(targetPath) {
  const pathFromRoot = relative(repositoryRoot, targetPath);

  if (pathFromRoot.startsWith('..') || pathFromRoot === '') {
    throw new Error(`拒絕存取專案外或專案根目錄：${targetPath}`);
  }
}

assertInsideRepository(outputRoot);

const manifestPath = resolve(repositoryRoot, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

for (const requiredField of ['display_name', 'js', 'author', 'version']) {
  if (!manifest[requiredField]) {
    throw new Error(`manifest.json 缺少必要欄位：${requiredField}`);
  }
}

const versionModulePath = resolve(repositoryRoot, 'src/generated/version.v042.js');
const versionModuleSource = `// This file is generated from manifest.json by scripts/build.mjs.\n// Do not edit it by hand.\nexport const APP_VERSION = ${JSON.stringify(manifest.version)};\nexport const MANIFEST_VERSION = APP_VERSION;\nexport const RUNTIME_VERSION = APP_VERSION;\n`;

assertInsideRepository(versionModulePath);
await mkdir(dirname(versionModulePath), { recursive: true });
await writeFile(versionModulePath, versionModuleSource, 'utf8');

for (const runtimeFile of [manifest.js, manifest.css].filter(Boolean)) {
  if (!buildConfig.files.includes(runtimeFile)) {
    throw new Error(`建置清單缺少 manifest 引用檔案：${runtimeFile}`);
  }
}

await rm(outputRoot, { recursive: true, force: true });

for (const relativePath of buildConfig.files) {
  const sourcePath = resolve(repositoryRoot, relativePath);
  const destinationPath = resolve(outputRoot, relativePath);

  assertInsideRepository(sourcePath);
  assertInsideRepository(destinationPath);
  await mkdir(dirname(destinationPath), { recursive: true });
  await copyFile(sourcePath, destinationPath);
}

console.log(`浮生錄前端擴充已建置：${outputRoot}`);
