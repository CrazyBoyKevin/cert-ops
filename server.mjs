import http from 'node:http';
import next from 'next';
import nextEnv from '@next/env';
import { resolve } from 'node:path';
import { HttpsRuntime, HTTPS_RUNTIME } from './server/https-runtime.mjs';

const dev = !process.argv.includes('--production');
nextEnv.loadEnvConfig(process.cwd(), dev);
const option = (name, fallback) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; };
const port = Number(option('--port', process.env.PORT || 3000));
const hostname = option('--hostname', process.env.HOSTNAME || '0.0.0.0');
const tlsPort = Number(process.env.CERTOPS_HTTPS_PORT || 9443);
if (![port, tlsPort].every((value) => Number.isInteger(value) && value > 0 && value < 65536) || port === tlsPort) throw new Error('Invalid HTTP / HTTPS ports');
const app = next({ dev, hostname, port, webpack: dev, turbopack: false });
const handle = app.getRequestHandler();
let runtime;
const handler = (req, res) => {
  // Direct TLS termination: never allow client-supplied proxy headers to claim TLS.
  delete req.headers['x-certops-tls']; delete req.headers['x-forwarded-host'];
  req.headers['x-forwarded-proto'] = req.socket.encrypted ? 'https' : 'http';
  if (req.socket.encrypted) req.headers['x-certops-tls'] = runtime.transportToken;
  if (req.url === '/healthz' && (req.method === 'GET' || req.method === 'HEAD')) {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); res.end('ok'); return;
  }
  if (runtime.handleHttp(req, res)) return;
  handle(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
};
runtime = new HttpsRuntime({ directory: resolve(process.env.CERTOPS_DATA_DIR || './data'), secret: process.env.CERT_ENCRYPTION_KEY,
  hostname, port: tlsPort, handler, recovery: process.env.CERTOPS_HTTPS_RECOVERY === 'true' });
globalThis[HTTPS_RUNTIME] = runtime;
await runtime.start(); // Fail closed before opening HTTP if persisted TLS cannot be loaded.
await app.prepare();
const server = http.createServer(handler);
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, hostname, resolve); });
console.log(`CertOps ready: http://${hostname}:${port}; HTTPS ${runtime.status().configured ? `listening on ${tlsPort}` : `available after certificate upload (port ${tlsPort})`}`);
if (runtime.recovery) console.warn('HTTPS recovery active: HTTP is available. Isolate access and remove CERTOPS_HTTPS_RECOVERY after repair.');
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  server.closeAllConnections(); server.close(); await runtime.close(); await app.close(); process.exit(0);
}
process.on('SIGTERM', stop); process.on('SIGINT', stop);
