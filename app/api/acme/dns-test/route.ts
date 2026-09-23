import { requireApiSession } from "@/lib/auth";
import { withAcmeDb, requireEncryption } from "@/lib/acme-store";
import { readAliyunCredential } from "@/lib/aliyun-credentials";
import { normalizeDomain, validateId } from "@/lib/acme-validation";
import { aliyunRequest } from "@/lib/aliyun-dns";
import { acmeResponse, acmeApiError, acmeBody } from "@/lib/acme-api";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const unauthorized = requireApiSession(request); if (unauthorized) return unauthorized;
  try {
    const body = await acmeBody(request);
    const zone = normalizeDomain(body.zone, false);
    requireEncryption();
    const config = await withAcmeDb((db) => readAliyunCredential(db, validateId(body.credentialId)));
    await aliyunRequest(config)("DescribeDomainRecords", { DomainName: zone, PageSize: 1 });
    return acmeResponse({ ok: true });
  } catch (error) { return acmeApiError(error); }
}
