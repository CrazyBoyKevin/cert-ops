import { NextResponse } from "next/server";
import { AcmeError } from "./acme-validation";

export function acmeResponse(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
export function acmeApiError(error: unknown) {
  return acmeResponse({ error: error instanceof AcmeError ? error.message : "SERVICE_UNAVAILABLE" }, error instanceof AcmeError ? 400 : 503);
}
export async function acmeBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 16_384) throw new AcmeError("INVALID_REQUEST");
  let value;
  try { value = JSON.parse(text); } catch { throw new AcmeError("INVALID_REQUEST"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AcmeError("INVALID_REQUEST");
  return value;
}
