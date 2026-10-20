import { X509Certificate, createPrivateKey, createPublicKey, createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { createSecureContext } from 'node:tls';
import { createServer } from 'node:https';
import { isIP } from 'node:net';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export const HTTPS_RUNTIME = Symbol.for('certops.https.runtime');
export const MAX_TLS_INPUT = 256 * 1024;

export function validateCertificate(cert, key, origin, now = Date.now()) {
  if (typeof cert !== 'string' || typeof key !== 'string' || cert.length > MAX_TLS_INPUT || key.length > MAX_TLS_INPUT) throw new Error('INVALID_CERTIFICATE');
  let url;
  try { url = new URL(origin); } catch { throw new Error('INVALID_ORIGIN'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('INVALID_ORIGIN');
  try {
    const blocks = cert.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
    if (!blocks?.length || cert.replace(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g, '').trim()) throw new Error();
    const chain = blocks.map((pem) => new X509Certificate(pem));
    const leaf = chain[0];
    if (leaf.ca || (now !== null && chain.some((item) => Date.parse(item.validFrom) > now || Date.parse(item.validTo) <= now))) throw new Error();
    if (leaf.keyUsage?.length && !leaf.keyUsage.includes('1.3.6.1.5.5.7.3.1')) throw new Error();
    const privateKey = createPrivateKey(key);
    if (!leaf.publicKey.export({ type: 'spki', format: 'der' }).equals(createPublicKey(privateKey).export({ type: 'spki', format: 'der' }))) throw new Error();
    for (let i = 0; i < chain.length - 1; i++) {
      if (!chain[i + 1].ca || !chain[i].verify(chain[i + 1].publicKey)) throw new Error();
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (!(isIP(hostname) ? leaf.checkIP(hostname) : leaf.checkHost(hostname, { subject: 'never' }))) throw new Error('HOSTNAME_MISMATCH');
    createSecureContext({ cert, key, minVersion: 'TLSv1.2' });
    return { origin: url.origin, subject: leaf.subject, issuer: leaf.issuer, domains: leaf.subjectAltName || '', expiresAt: new Date(leaf.validTo).toISOString(), fingerprint: leaf.fingerprint256 };
  } catch (error) {
    throw new Error(error.message === 'HOSTNAME_MISMATCH' ? error.message : 'INVALID_CERTIFICATE');
  }
}

function encryptionKey(secret) {
  if (!secret || secret.length < 32 || /change.?me|replace.?me|example/i.test(secret)) throw new Error('ENCRYPTION_KEY_REQUIRED');
  return createHash('sha256').update(secret).digest();
}

export class HttpsRuntime {
  constructor({ directory, secret, hostname = '0.0.0.0', port = 9443, handler, recovery = false }) {
    this.directory = directory; this.secret = secret; this.hostname = hostname; this.port = port;
    this.handler = handler; this.recovery = recovery;
    this.transportToken = randomBytes(32).toString('hex');
    this.config = null; this.server = null; this.busy = false;
  }
  secure(request) { return request.headers.get('x-certops-tls') === this.transportToken; }
  status() {
    return { supported: true, configured: !!this.config, forced: !!this.config?.force && !this.recovery, recovery: this.recovery,
      port: this.port, origin: this.config?.origin || '', certificate: this.config?.metadata || null };
  }
  async start() {
    // Recovery deliberately ignores persisted TLS state. Only use on a trusted, isolated network.
    if (this.recovery) return;
    let envelope;
    try { envelope = await readFile(join(this.directory, 'https.enc'), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    try {
      const { iv, tag, data } = JSON.parse(envelope);
      const decipher = createDecipheriv('aes-256-gcm', encryptionKey(this.secret), Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      const config = JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString());
      // Expired certificates stay loaded, so a restart never silently restores HTTP access.
      // New uploads are always checked against the current date.
      config.metadata = validateCertificate(config.cert, config.key, config.origin, null);
      if (typeof config.force !== 'boolean') throw new Error();
      await this.listen(config);
      this.config = config;
    } catch { throw new Error('HTTPS_CONFIG_UNREADABLE: check CERT_ENCRYPTION_KEY / TLS data; explicit recovery is required.'); }
  }
  async listen(config) {
    const server = createServer({ cert: config.cert, key: config.key, minVersion: 'TLSv1.2' }, this.handler);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.port, this.hostname, () => { server.off('error', reject); resolve(); });
    });
    this.port = server.address().port;
    this.server = server;
    server.on('error', () => console.error('HTTPS listener error'));
  }
  async persist(config) {
    const key = encryptionKey(this.secret), iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(config)), cipher.final()]);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temp = join(this.directory, `https-${randomBytes(8).toString('hex')}.tmp`);
    try {
      await writeFile(temp, JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }), { mode: 0o600, flag: 'wx' });
      await rename(temp, join(this.directory, 'https.enc'));
    } finally { await unlink(temp).catch(() => {}); }
  }
  async update(input, { secure = false, origin = '' } = {}) {
    if (this.busy) throw new Error('BUSY');
    this.busy = true;
    try {
      let config;
      if (input.action === 'certificate') {
        const metadata = validateCertificate(input.cert, input.key, input.origin);
        if (this.status().forced && metadata.origin !== this.config.origin) throw new Error('DISABLE_FORCE_FIRST');
        config = { cert: input.cert, key: input.key, origin: metadata.origin, metadata, force: this.status().forced };
      } else if (input.action === 'force' && typeof input.enabled === 'boolean' && this.config) {
        if (input.enabled && (this.recovery || !secure || origin !== this.config.origin)) throw new Error('VERIFY_HTTPS_FIRST');
        if (input.enabled) validateCertificate(this.config.cert, this.config.key, this.config.origin);
        config = { ...this.config, force: input.enabled };
      } else throw new Error('INVALID_INPUT');
      encryptionKey(this.secret);
      const alreadyListening = !!this.server;
      if (!alreadyListening) await this.listen(config);
      try { await this.persist(config); }
      catch (error) { if (!alreadyListening) { await this.close(); } throw error; }
      if (alreadyListening) {
        this.server.setSecureContext({ cert: config.cert, key: config.key, minVersion: 'TLSv1.2' });
        this.server.setTicketKeys(randomBytes(48));
      }
      this.config = config;
      return this.status();
    } finally { this.busy = false; }
  }
  async close() {
    const server = this.server; this.server = null;
    if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  }
  handleHttp(req, res) {
    if (!this.status().forced || req.socket.encrypted) return false;
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(426, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'HTTPS_REQUIRED' }));
    } else {
      // Concatenate a validated fixed origin, never resolve //evil.example against it.
      const path = req.url?.startsWith('/') ? req.url : '/';
      res.writeHead(307, { Location: this.config.origin + path }); res.end();
    }
    return true;
  }
}
