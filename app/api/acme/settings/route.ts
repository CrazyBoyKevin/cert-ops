import { requireApiSession } from "@/lib/auth";
import { withAcmeDb, readPublicAcmeSettings, saveAcmeSettings } from "@/lib/acme-store";
import { acmeResponse, acmeApiError, acmeBody } from "@/lib/acme-api";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const unauthorized = requireApiSession(request); if (unauthorized) return unauthorized;
  try { return acmeResponse({ data: await withAcmeDb(readPublicAcmeSettings) }); }
  catch (error) { return acmeApiError(error); }
}
export async function PUT(request: Request) {
  const unauthorized = requireApiSession(request); if (unauthorized) return unauthorized;
  try { return acmeResponse({ data: await saveAcmeSettings(await acmeBody(request)) }); }
  catch (error) { return acmeApiError(error); }
}
