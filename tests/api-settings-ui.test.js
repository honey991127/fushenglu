import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../src/ui/app.js', import.meta.url), 'utf8');
const styleSource = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

test('API 設定保存後會重新讀取並重繪設定頁', () => {
  assert.match(appSource, /settingsStore\.save\(readApiForm\(\)\)/);
  assert.match(appSource, /const saved = settingsStore\.load\(\);/);
  assert.match(appSource, /renderApi\(\);\s*showScreen\('api'\);/);
});

test('未載入模型時三個模型輸入框仍是可見的自訂 combo box', () => {
  for (const field of [
    'analysisModel',
  'generationModel',
  'validationModel',
]) {
    assert.match(appSource, new RegExp(`renderModelCombo\\('${field}',`));
  }

  assert.match(appSource, /name="\$\{name\}"/);
  assert.match(appSource, /data-model-field="\$\{name\}"/);
  assert.match(appSource, /尚未載入模型，仍可手動輸入/);
  assert.doesNotMatch(appSource, /<datalist/);
  assert.match(styleSource, /\.fushenglu-model-combo/);
  assert.match(styleSource, /min-height: 46px !important/);
});

test('載入模型後可選擇模型，也保留手動輸入與空清單緊湊提示', () => {
  assert.match(appSource, /data-action="choose-model"/);
  assert.match(appSource, /input\.value = target\.dataset\.model/);
  assert.match(appSource, /成功載入 \$\{loadedModels\.length\} 個模型/);
  assert.match(appSource, /沒有找到模型，仍可手動輸入/);
  assert.match(styleSource, /\.fushenglu-model-menu-empty/);
  assert.match(styleSource, /max-height: 176px/);
});

test('iPhone 寬度的 API 頁保留底部導覽與鍵盤可見空間', () => {
  assert.match(styleSource, /\.fushenglu-content \{\s*flex: 1 1 auto;/);
  assert.match(styleSource, /calc\(150px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(
    styleSource,
    /\.fushenglu-screen\[data-screen="api"\] \{\s*padding-bottom: calc\(46px \+ env\(safe-area-inset-bottom\)\)/,
  );
  assert.match(appSource, /field\.scrollIntoView\(\{ block: 'nearest' \}\)/);
});
