import { timingSafeEqual, createHash } from "node:crypto";
import { runAcmeCheck } from "@/lib/acme-worker";
import { acmeResponse, acmeApiError } from "@/lib/acme-api";

export const runtime = "nodejs";
export const maxDuration = 900;
export async function POST(request: Request) {
  if (!process.env.CRON_SECRET) return acmeResponse({ error: "CRON_NOT_CONFIGURED" }, 503);
  const hash = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(hash(request.headers.get("authorization") || ""), hash(`Bearer ${process.env.CRON_SECRET}`))) return acmeResponse({ error: "UNAUTHORIZED" }, 401);
  try { return acmeResponse(await runAcmeCheck()); } catch (error) { return acmeApiError(error); }
}
