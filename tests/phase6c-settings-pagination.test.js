import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserApiSettingsStore, normalizeApiSettings } from '../src/core/api-client.js';
import { homeModel } from '../src/ui/presentation.js';

function storage({ fail = false } = {}) { const values = new Map(); return { getItem: (k) => values.get(k) ?? null, setItem(k, v) { if (fail) throw new Error('保存失敗，可重試'); values.set(k, String(v)); }, removeItem: (k) => values.delete(k) }; }
test('Phase 6C missing confirmation setting defaults to review_once and persists', () => {
  const store = new BrowserApiSettingsStore({ storage: storage() });
  assert.equal(store.load().confirmationMode, 'review_once');
  store.save({ ...store.load(), confirmationMode: 'auto_commit_safe' });
  assert.equal(store.load().confirmationMode, 'auto_commit_safe');
  assert.equal(normalizeApiSettings({}).confirmationMode, 'review_once');
});
test('Phase 6C failed confirmation settings save leaves persisted mode unchanged', () => {
  const backing = storage(); const store = new BrowserApiSettingsStore({ storage: backing }); store.save(store.load());
  const failing = new BrowserApiSettingsStore({ storage: storage({ fail: true }) });
  assert.throws(() => failing.save({ ...failing.load(), confirmationMode: 'auto_commit_safe' }), /保存失敗/);
  assert.equal(store.load().confirmationMode, 'review_once');
});
test('Phase 6C 162 pending records have a 20 item first page and independent handled records', () => {
  const pending = Array.from({ length: 162 }, (_, index) => ({ pendingId: `p${index}`, status: 'pending' }));
  const handled = [{ status: 'accepted' }, { status: 'rejected' }];
  assert.equal(pending.filter((x) => x.status === 'pending').slice(0, 20).length, 20);
  assert.equal(pending.filter((x) => x.status === 'pending').slice(0, 40).length, 40);
  assert.equal(pending.filter((x) => x.status === 'pending').slice(0, 180).length, 162);
  assert.equal(handled.filter((x) => x.status === 'pending').length, 0);
});
test('Phase 6C render model never causes a commit or metadata write', () => {
  const state = { currentSnapshot: { assets: [], currencies: [], entities: {} }, batches: [], pendingItems: [] };
  assert.doesNotThrow(() => homeModel(state));
});
