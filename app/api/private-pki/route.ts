import { X509Certificate } from "node:crypto";
import { requireApiSession } from "@/lib/auth";
import { PkiError, pkiId } from "@/lib/private-pki";
import { listPrivateAuthorities, savePrivateAuthority, deletePrivateAuthority, importPrivateAuthority, importPrivateService, issuePrivateService, privateServiceDetails, privateRootContents, privateVersionContents, deletePrivateVersion } from "@/lib/private-pki-store";
import { createZipArchive } from "@/lib/zip";

export const runtime = "nodejs";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const errorResponse = (error: unknown) => json({ error: error instanceof PkiError ? error.message : "SERVICE_UNAVAILABLE" }, error instanceof PkiError ? 400 : 503);
export async function GET(request: Request) {
  const unauthorized = requireApiSession(request); if (unauthorized) return unauthorized;
  try {
    const id = new URL(request.url).searchParams.get("certificateId");
    return json({ data: id ? await privateServiceDetails(pkiId(id)) : await listPrivateAuthorities() });
  } catch (error) { return errorResponse(error); }
}
function file(data: string | Uint8Array, name: string, type: string) {
  return new Response(typeof data === "string" ? data : new Uint8Array(data).buffer, { headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
export async function POST(request: Request) {
  const unauthorized = requireApiSession(request); if (unauthorized) return unauthorized;
  try {
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new PkiError("INVALID_INPUT");
    const origin = request.headers.get("origin");
    // Host is preserved by the reverse proxy; request.url can use an internal origin.
    if ((origin && new URL(origin).host !== (request.headers.get("host") || new URL(request.url).host)) || request.headers.get("sec-fetch-site") === "cross-site") throw new PkiError("INVALID_INPUT");
    const text = await request.text();
    if (text.length > 524_288) throw new PkiError("INVALID_INPUT");
    let body;
    try { body = JSON.parse(text); } catch { throw new PkiError("INVALID_INPUT"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new PkiError("INVALID_INPUT");
    switch (body.action) {
      case "createCA": return json({ data: await savePrivateAuthority(body) }, 201);
      case "deleteCA": return json({ data: await deletePrivateAuthority(body) });
      case "importCA": return json({ data: await importPrivateAuthority(body) }, 201);
      case "importService": return json({ data: await importPrivateService(body) }, 201);
      case "issue": return json({ data: await issuePrivateService(body) }, 201);
      case "renew": return json({ data: await issuePrivateService(body, true) });
      case "deleteVersion": return json({ data: await deletePrivateVersion(body) });
      case "downloadRoot": {
        const pem = await privateRootContents(pkiId(body.id));
        return body.format === "der" ? file(new X509Certificate(pem).raw, "root-ca.cer", "application/pkix-cert") : file(pem, "root-ca.crt", "application/x-pem-file");
      }
      case "downloadVersion": {
        const pair = await privateVersionContents(pkiId(body.id));
        if (body.format === "pem") return file(pair.certificatePem, "server.pem", "application/x-pem-file");
        if (!pair.privateKey) throw new PkiError("SERVICE_KEY_REQUIRED");
        return file(createZipArchive([{ name: "server.pem", data: pair.certificatePem }, { name: "server.key", data: pair.privateKey }]), "service-certificate.zip", "application/zip");
      }
      default: throw new PkiError("INVALID_INPUT");
    }
  } catch (error) { return errorResponse(error); }
}
