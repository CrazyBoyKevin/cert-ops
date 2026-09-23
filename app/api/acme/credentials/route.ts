import { requireApiSession } from "@/lib/auth";
import { withAcmeDb, requireEncryption } from "@/lib/acme-store";
import { listAliyunCredentials, saveAliyunCredential, removeAliyunCredential } from "@/lib/aliyun-credentials";
import { AcmeError, validateId } from "@/lib/acme-validation";
import { acmeResponse, acmeApiError, acmeBody } from "@/lib/acme-api";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const unauthorized = requireApiSession(request); if (unauthorized) return unauthorized;
  try { return acmeResponse({ data: await withAcmeDb(listAliyunCredentials) }); }
  catch (error) { return acmeApiError(error); }
}
async function save(request: Request, editing: boolean) {
  const unauthorized = requireApiSession(request); if (unauthorized) return unauthorized;
  try {
    requireEncryption();
    const body = await acmeBody(request);
    const id = editing ? validateId(body.id) : undefined;
    return acmeResponse({ data: await withAcmeDb((db) => saveAliyunCredential(db, body, id)) }, editing ? 200 : 201);
  } catch (error) { return acmeApiError(error); }
}
export async function POST(request: Request) { return save(request, false); }
export async function PATCH(request: Request) { return save(request, true); }
export async function DELETE(request: Request) {
  const unauthorized = requireApiSession(request); if (unauthorized) return unauthorized;
  try {
    const body = await acmeBody(request);
    if (body.confirmed !== true) throw new AcmeError("INVALID_REQUEST");
    await withAcmeDb((db) => removeAliyunCredential(db, validateId(body.id)));
    return acmeResponse({ ok: true });
  } catch (error) { return acmeApiError(error); }
}
