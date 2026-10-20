import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = (file) => readFile(new URL('../' + file, import.meta.url), 'utf8');
test('HTTPS settings omit static explanations but retain validation and feedback', async () => {
  const page = await source('app/https-panel.tsx');
  assert.doesNotMatch(page, /copy\.(intro|plainWarning|originHint|certHint|keyHint|forceHint|verify|help)\b/);
  assert.match(page, /role="alert"/);
  assert.match(page, /window\.confirm\(copy\.confirm\)/);
  assert.match(page, /!status\.secure \|\| status\.recovery/);
  assert.match(page, /status\.configured && <small>/);
  assert.match(page, /<label><span>\{copy\.origin\}<\/span>/);
});
test('settings and editing dialogs omit redundant introductory subtitles', async () => {
  const workspace = await source('app/page.tsx');
  const acme = await source('app/acme-panel.tsx');
  assert.doesNotMatch(workspace, /<p>\{copy\.(uploadSubtitle|editDesc|groupDesc|reminderDesc)\}<\/p>/);
  assert.doesNotMatch(acme, /<p>\{copy\.subtitle\}<\/p>/);
  assert.match(workspace, /copy\.deleteGroupWarning/);
  assert.match(acme, /manual-dns/);
  assert.match(await source('README.md'), /首次配置仍从 HTTP/);
});
