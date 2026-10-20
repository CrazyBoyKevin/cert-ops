import assert from 'node:assert/strict';
import { request as tlsRequest } from 'node:https';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createPrivateRoot, issuePrivateCertificate } from '../lib/private-pki.ts';
import { HttpsRuntime } from '../server/https-runtime.mjs';

export async function freePort() {
  const server = createServer().listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise((resolve) => server.close(resolve)); return port;
}
function secureFetch(url, ca, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = tlsRequest(url, { method, headers, ca, agent: false }, (response) => {
      let text = ''; response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text, json: () => JSON.parse(text) }));
    });
    request.on('error', reject); request.setTimeout(5000, () => request.destroy(new Error('TLS timeout'))); request.end(body);
  });
}
export async function platformHttpsCases({ base, cookie, env }) {
  const url = base + '/api/platform/https';
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { method: 'PUT' })).status, 401);
  const initial = await (await fetch(url, { headers: { Cookie: cookie } })).json();
  assert.equal(initial.data.supported, true, 'Next API and custom server must share runtime');
  assert.equal(initial.data.secure, false);
  const root = await createPrivateRoot({ CN: 'Disposable Console Root' }, 365);
  const hostname = new URL(base).hostname;
  const names = [...new Set(['127.0.0.1', hostname])];
  const leaf = await issuePrivateCertificate(root, names, 30);
  const origin = `https://${hostname}:${env.CERTOPS_HTTPS_PORT}`;
  const upload = { action: 'certificate', cert: leaf.certificatePem + root.certificatePem, key: leaf.privateKey, origin };
  const headers = { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' };
  const put = (body, extra = {}) => fetch(url, { method: 'PUT', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
  assert.equal((await put(upload, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await put({ ...upload, key: root.privateKey })).status, 400);
  assert.equal((await put({ ...upload, origin: 'https://127.0.0.2:9443' })).status, 400);
  const saved = await put(upload); assert.equal(saved.status, 200);
  assert.ok(!(await saved.text()).includes('PRIVATE KEY'));
  assert.equal((await put({ action: 'force', enabled: true }, { 'X-Forwarded-Proto': 'https', 'X-Certops-Tls': 'forged' })).status, 400);
  assert.equal((await put({ action: 'force', enabled: 'true' })).status, 400);
  const tooBig = await put({ data: 'x'.repeat(601 * 1024) }); assert.equal(tooBig.status, 413);
  const options = { headers: { Cookie: cookie } };
  const tlsStatus = await secureFetch(origin + '/api/platform/https', root.certificatePem, options);
  assert.equal(tlsStatus.status, 200); assert.equal(tlsStatus.json().data.secure, true);
  const login = await secureFetch(origin + '/api/auth/login', root.certificatePem, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: env.CERTOPS_ADMIN_USERNAME, password: env.CERTOPS_ADMIN_PASSWORD }) });
  assert.equal(login.status, 200); assert.match(login.headers['set-cookie'].join(';'), /; Secure/i);
  const page = await secureFetch(origin + '/settings?tab=https', root.certificatePem, options);
  assert.equal(page.status, 200); assert.match(page.headers['set-cookie'].join(';'), /; Secure/i);
  const securePut = (body) => secureFetch(origin + '/api/platform/https', root.certificatePem, { method: 'PUT', headers: { ...headers, Origin: origin }, body: JSON.stringify(body) });
  const forced = await securePut({ action: 'force', enabled: true }); assert.equal(forced.status, 200); assert.equal(forced.json().data.forced, true);
  const redirect = await fetch(base + '/settings?tab=https', { redirect: 'manual', headers: { Host: 'evil.test' } });
  assert.equal(redirect.status, 307); assert.equal(redirect.headers.get('location'), origin + '/settings?tab=https');
  assert.equal((await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'X-Forwarded-Proto': 'https' } })).status, 426);
  assert.equal((await fetch(base + '/healthz')).status, 200);
  const replacement = await issuePrivateCertificate(root, names, 20);
  assert.equal((await securePut({ ...upload, cert: replacement.certificatePem + root.certificatePem, key: replacement.privateKey })).status, 200);
  const refreshed = await secureFetch(origin + '/api/platform/https', root.certificatePem, options);
  assert.notEqual(refreshed.json().data.certificate.fingerprint, tlsStatus.json().data.certificate.fingerprint);
  assert.equal(refreshed.json().data.forced, true);
  assert.equal((await securePut({ ...upload, origin: 'https://127.0.0.1:1234' })).status, 400);
  const filename = path.join(env.CERTOPS_DATA_DIR, 'https.enc');
  const disk = await readFile(filename, 'utf8'); assert.ok(!disk.includes('PRIVATE KEY')); assert.ok(!disk.includes('CERTIFICATE'));
  assert.equal((await stat(filename)).mode & 0o777, 0o600);
  // Separate listener verifies encrypted restart / fail-closed behavior without touching the app's config.
  const restarted = new HttpsRuntime({ directory: env.CERTOPS_DATA_DIR, secret: env.CERT_ENCRYPTION_KEY, port: 0, hostname: '127.0.0.1', handler(_req, res) { res.end('restored'); } });
  try {
    await restarted.start(); assert.equal(restarted.status().forced, true);
    assert.equal((await secureFetch(`https://127.0.0.1:${restarted.port}`, root.certificatePem)).text, 'restored');
  } finally { await restarted.close(); }
  const wrongKey = new HttpsRuntime({ directory: env.CERTOPS_DATA_DIR, secret: 'x'.repeat(40), handler() {} });
  await assert.rejects(wrongKey.start(), /HTTPS_CONFIG_UNREADABLE/);
  const recovery = new HttpsRuntime({ directory: env.CERTOPS_DATA_DIR, secret: 'x'.repeat(40), recovery: true, handler() {} });
  await recovery.start(); assert.equal(recovery.status().forced, false); assert.equal(recovery.status().configured, false);
  assert.equal(await readFile(filename, 'utf8'), disk);
  assert.equal((await securePut({ action: 'force', enabled: false })).status, 200);
  assert.equal((await fetch(base + '/login')).status, 200);
  console.log('HTTPS upload, real trusted TLS, hot rotation, encrypted restart, CSRF, spoof protection, enforcement, recovery and cookies passed.');
}
