import 'server-only';

export type HttpsStatus = {
  supported: boolean; configured: boolean; forced: boolean; recovery: boolean; port: number; origin: string;
  certificate: { subject: string; issuer: string; domains: string; expiresAt: string; fingerprint: string } | null;
  secure?: boolean;
};
type Runtime = { status(): HttpsStatus; secure(request: Request): boolean; update(input: unknown, context: { secure: boolean; origin: string }): Promise<HttpsStatus> };
export function httpsRuntime() {
  return (globalThis as unknown as Record<symbol, Runtime | undefined>)[Symbol.for('certops.https.runtime')];
}
