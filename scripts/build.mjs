import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildConfig } from '../build.config.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = resolve(repositoryRoot, buildConfig.outputDirectory);
const manifestPath = resolve(repositoryRoot, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const modules = new Map();
const visiting = new Set();
const staticImportPattern = /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+\.js)['"]/g;
const dynamicImportPattern = /\bimport\s*\(\s*['"]([^'"]+\.js)['"]\s*\)/g;

function assertInsideRepository(targetPath) {
  const pathFromRoot = relative(repositoryRoot, targetPath);
  if (pathFromRoot.startsWith('..') || pathFromRoot === '') {
    throw new Error('??????????????' + targetPath);
  }
}

function toRepositoryPath(path) {
  return relative(repositoryRoot, path).replaceAll('\\', '/');
}

function localDependencies(source) {
  const dependencies = [];
  for (const match of source.matchAll(staticImportPattern)) dependencies.push(match[1]);
  for (const match of source.matchAll(dynamicImportPattern)) dependencies.push(match[1]);
  return [...new Set(dependencies.filter((specifier) => specifier.startsWith('.')))];
}

async function buildRuntimeModule(sourceRelative) {
  if (modules.has(sourceRelative)) return modules.get(sourceRelative);
  if (visiting.has(sourceRelative)) throw new Error('Runtime imports must not be circular: ' + sourceRelative);
  visiting.add(sourceRelative);

  const sourcePath = resolve(repositoryRoot, sourceRelative);
  assertInsideRepository(sourcePath);
  let source = await readFile(sourcePath, 'utf8');
  source = source.replaceAll('__FUSHENGLU_VERSION__', manifest.version);

  for (const specifier of localDependencies(source)) {
    const dependencyPath = resolve(dirname(sourcePath), specifier);
    assertInsideRepository(dependencyPath);
    const dependencyRelative = toRepositoryPath(dependencyPath);
    if (!dependencyRelative.startsWith('src/') || !dependencyRelative.endsWith('.js')) {
      throw new Error('Runtime import escapes src: ' + sourceRelative + ' -> ' + specifier);
    }
    const dependency = await buildRuntimeModule(dependencyRelative);
    let generatedSpecifier = posix.relative(posix.dirname(sourceRelative), dependency.outputPath);
    if (!generatedSpecifier.startsWith('.')) generatedSpecifier = './' + generatedSpecifier;
    source = source.replaceAll(specifier, generatedSpecifier);
  }

  const hash = createHash('sha256').update(source).digest('hex').slice(0, 12);
  const outputPath = sourceRelative.replace(/\.js$/, '.' + hash + '.js');
  const module = { sourceRelative, outputPath, source };
  modules.set(sourceRelative, module);
  visiting.delete(sourceRelative);
  return module;
}

for (const requiredField of ['display_name', 'js', 'author', 'version']) {
  if (!manifest[requiredField]) throw new Error('manifest.json ???????' + requiredField);
}

assertInsideRepository(outputRoot);
const entry = await buildRuntimeModule(manifest.js);
await rm(outputRoot, { recursive: true, force: true });

for (const staticFile of buildConfig.staticFiles) {
  const sourcePath = resolve(repositoryRoot, staticFile);
  const destinationPath = resolve(outputRoot, staticFile);
  assertInsideRepository(sourcePath);
  assertInsideRepository(destinationPath);
  await mkdir(dirname(destinationPath), { recursive: true });
  await copyFile(sourcePath, destinationPath);
}

for (const module of modules.values()) {
  const destinationPath = resolve(outputRoot, module.outputPath);
  assertInsideRepository(destinationPath);
  await mkdir(dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, module.source, 'utf8');
}

const distributionManifest = { ...manifest, js: entry.outputPath };
await writeFile(resolve(outputRoot, 'manifest.json'), JSON.stringify(distributionManifest, null, 2) + '\n', 'utf8');
console.log('???????????' + outputRoot);
