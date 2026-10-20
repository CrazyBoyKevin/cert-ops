import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { BRAND_ICON_URL } from '../lib/brand.ts';

const source = (name) => readFile(new URL('../' + name, import.meta.url), 'utf8');
test('login and workspace reuse the same brand component and favicon asset', async () => {
  const [login, workspace, brand, layout, icon] = await Promise.all(['app/login/login-form.tsx', 'app/page.tsx', 'app/brand.tsx', 'app/layout.tsx', 'public/favicon.svg'].map(source));
  assert.match(login, /<Brand appearance="login" \/>/);
  assert.match(workspace, /<Brand \/>/);
  assert.doesNotMatch(login, /login-brand|ShieldCheck/);
  assert.match(brand, /src=\{BRAND_ICON_URL\}/);
  assert.match(layout, /icon: BRAND_ICON_URL/);
  assert.match(layout, /shortcut: BRAND_ICON_URL/);
  assert.equal(BRAND_ICON_URL.split('?')[0], '/favicon.svg');
  assert.match(icon, /viewBox="0 0 36 40"/);
  assert.match(icon, /fill="#bdbdbd"/);
  for (const [, r, g, b] of icon.matchAll(/#([\da-f]{2})([\da-f]{2})([\da-f]{2})/gi)) {
    assert.equal(r, g, 'brand colors must be neutral');
    assert.equal(g, b, 'brand colors must be neutral');
  }
});
test('sidebar and certificate list share neutral project markers', async () => {
  const [workspace, css] = await Promise.all(['app/page.tsx', 'app/globals.css'].map(source));
  assert.doesNotMatch(workspace, /background: (?:group\.color|certificate\.groupColor)/);
  assert.match(css, /--group-marker: #949494;/);
  assert.match(css, /\.group-dot \{[^}]*background: var\(--group-marker\)/);
  assert.match(css, /\.project-tag i \{[^}]*background: var\(--group-marker\)/);
});
test('compact sidebar styles do not hide the login wordmark', async () => {
  const css = await source('app/globals.css');
  assert.match(css, /\.brand--sidebar > \.brand-copy[^{}]*\{ display: none; \}/);
  assert.doesNotMatch(css, /\.brand > span:last-child|\.login-brand|\.brand-seal/);
  assert.match(css, /\.brand-name \{[^}]*color: var\(--brand-text\)/);
});
