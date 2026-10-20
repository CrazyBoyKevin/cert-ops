import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateRoot, issuePrivateCertificate } from '../lib/private-pki.ts';
import { validateCertificate, HttpsRuntime } from '../server/https-runtime.mjs';
import { httpsMessages } from '../lib/https-i18n.ts';

test('console TLS validates chain, key, SAN, lifetime, origin and rejects a CA leaf', async () => {
  const root = await createPrivateRoot({ CN: 'Console Test Root' }, 365);
  const leaf = await issuePrivateCertificate(root, ['127.0.0.1', '::1'], 30);
  const cert = leaf.certificatePem + root.certificatePem;
  const origin = 'https://127.0.0.1:9443';
  assert.equal(validateCertificate(cert, leaf.privateKey, origin).origin, origin);
  assert.equal(validateCertificate(cert, leaf.privateKey, 'https://[::1]:9443').origin, 'https://[::1]:9443');
  assert.throws(() => validateCertificate(cert, root.privateKey, origin), /INVALID_CERTIFICATE/);
  assert.throws(() => validateCertificate(root.certificatePem, root.privateKey, origin), /INVALID_CERTIFICATE/);
  assert.throws(() => validateCertificate(cert, leaf.privateKey, 'https://127.0.0.2:9443'), /HOSTNAME_MISMATCH/);
  assert.throws(() => validateCertificate(cert, leaf.privateKey, origin, Date.now() + 50 * 86400000), /INVALID_CERTIFICATE/);
  assert.throws(() => validateCertificate(cert, leaf.privateKey, origin, Date.now() - 50 * 86400000), /INVALID_CERTIFICATE/);
  assert.throws(() => validateCertificate('not a certificate', leaf.privateKey, origin), /INVALID_CERTIFICATE/);
  for (const value of ['http://127.0.0.1', 'https://user:password@127.0.0.1', origin + '/path', origin + '?q=1', origin + '#x']) {
    assert.throws(() => validateCertificate(cert, leaf.privateKey, value), /INVALID_ORIGIN/);
  }
});
test('HTTP enforcement uses a fixed origin and refuses plaintext mutations', () => {
  const runtime = new HttpsRuntime({ directory: '/unused', handler() {} });
  runtime.config = { origin: 'https://console.example:9443', force: true };
  function invoke(method, url, encrypted = false) {
    const response = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); }, end(body) { this.body = body; } };
    const intercepted = runtime.handleHttp({ method, url, socket: { encrypted } }, response);
    return { ...response, intercepted };
  }
  assert.equal(invoke('GET', '//evil.test/settings').headers.Location, 'https://console.example:9443//evil.test/settings');
  assert.equal(invoke('HEAD', '/settings?tab=https').status, 307);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) assert.equal(invoke(method, '/api/auth/login').status, 426);
  assert.equal(invoke('POST', '/api/auth/login', true).intercepted, false);
  runtime.recovery = true;
  assert.equal(invoke('POST', '/api/auth/login').intercepted, false);
});
test('HTTPS page has translations for all supported languages', () => {
  for (const language of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko']) {
    assert.deepEqual(Object.keys(httpsMessages(language)), Object.keys(httpsMessages('zh-CN')));
    assert.ok(Object.values(httpsMessages(language)).every((value) => value.trim()));
  }
});
