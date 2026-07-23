import test from 'node:test';
import assert from 'node:assert/strict';
import { t, setLanguage, getLanguage, SUPPORTED_LANGS } from '../lib/i18n.js';

test('defaults to a supported language outside the browser', () => {
  assert.ok(SUPPORTED_LANGS.includes(getLanguage()));
});

test('t() returns the translation for a known key', () => {
  setLanguage('en');
  assert.equal(t('install.btn'), 'Install');
});

test('t() interpolates {vars}', () => {
  setLanguage('en');
  assert.ok(t('result.confidence', { pct: 42 }).includes('42'));
});

test('t() falls back to the key itself for unknown keys', () => {
  assert.equal(t('nope.not.a.key'), 'nope.not.a.key');
});

test('setLanguage switches and rejects unsupported codes', () => {
  setLanguage('vi');
  assert.equal(getLanguage(), 'vi');
  const before = getLanguage();
  setLanguage('xx');
  assert.equal(getLanguage(), before);
  setLanguage('en');
});

test('vi dictionary covers the same keys used by core UI', () => {
  setLanguage('vi');
  for (const key of ['install.btn', 'analyze.btn', 'record.btn.idle', 'disclaimer.got-it']) {
    assert.notEqual(t(key), key, `missing vi translation for ${key}`);
  }
  setLanguage('en');
});
