import { requireApiSession } from '@/lib/auth';
import { httpsRuntime } from '@/lib/platform-https';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request: Request) {
  const unauthorized = requireApiSession(request); if (unauthorized) return unauthorized;
  const service = httpsRuntime();
  if (!service) return reply({ data: { supported: false } });
  return reply({ data: { ...service.status(), secure: service.secure(request) } });
}
export async function PUT(request: Request) {
  const unauthorized = requireApiSession(request); if (unauthorized) return unauthorized;
  const service = httpsRuntime();
  if (!service) return reply({ error: 'CUSTOM_SERVER_REQUIRED' }, 503);
  try {
    const origin = request.headers.get('origin');
    const secure = service.secure(request);
    const expectedOrigin = `${secure ? 'https' : 'http'}://${request.headers.get('host')}`;
    if (origin !== expectedOrigin || request.headers.get('sec-fetch-site') === 'cross-site') return reply({ error: 'INVALID_ORIGIN' }, 403);
    if (!request.headers.get('content-type')?.startsWith('application/json')) return reply({ error: 'INVALID_INPUT' }, 415);
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: 'INVALID_INPUT' }, 400);
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 600 * 1024) { await reader.cancel(); return reply({ error: 'INPUT_TOO_LARGE' }, 413); }
      chunks.push(value);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const data = await service.update(input, { secure, origin });
    return reply({ data: { ...data, secure } });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const safe = ['INVALID_INPUT', 'INVALID_CERTIFICATE', 'HOSTNAME_MISMATCH', 'INVALID_ORIGIN', 'ENCRYPTION_KEY_REQUIRED', 'VERIFY_HTTPS_FIRST', 'DISABLE_FORCE_FIRST', 'BUSY'];
    return reply({ error: safe.includes(code) ? code : 'HTTPS_SAVE_FAILED' }, code === 'BUSY' ? 409 : 400);
  }
}
