import { requireApiSession } from "@/lib/auth";
import { listAcmeOrders, queueAcmeOrder, changeAcmeOrder, removeAcmeOrder } from "@/lib/acme-store";
import { validateId, parseOrderQuery, AcmeError } from "@/lib/acme-validation";
import { acmeResponse, acmeApiError, acmeBody } from "@/lib/acme-api";
import { runManualAction } from "@/lib/acme-manual";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const unauthorized = requireApiSession(request); if (unauthorized) return unauthorized;
  try { return acmeResponse(await listAcmeOrders(parseOrderQuery(new URL(request.url).searchParams))); } catch (error) { return acmeApiError(error); }
}
export async function POST(request: Request) {
  const unauthorized = requireApiSession(request); if (unauthorized) return unauthorized;
  try { return acmeResponse({ data: await queueAcmeOrder(await acmeBody(request)) }, 202); }
  catch (error) { return acmeApiError(error); }
}
export async function PATCH(request: Request) {
  const unauthorized = requireApiSession(request); if (unauthorized) return unauthorized;
  try {
    const body = await acmeBody(request);
    if (body.action === "checkDns" || body.action === "continue") {
      return acmeResponse(await runManualAction(validateId(body.id), body.action));
    }
    await changeAcmeOrder(validateId(body.id), body.action, body.autoRenew);
    return acmeResponse({ ok: true });
  } catch (error) { return acmeApiError(error); }
}
export async function DELETE(request: Request) {
  const unauthorized = requireApiSession(request); if (unauthorized) return unauthorized;
  try {
    const body = await acmeBody(request);
    if (body.confirmed !== true) throw new AcmeError("INVALID_REQUEST");
    await removeAcmeOrder(validateId(body.id));
    return acmeResponse({ ok: true });
  } catch (error) { return acmeApiError(error); }
}
