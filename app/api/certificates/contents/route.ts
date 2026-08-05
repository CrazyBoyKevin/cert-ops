import { X509Certificate } from "node:crypto";
import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { getCertificateContents } from "@/lib/repository";
import { createZipArchive } from "@/lib/zip";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const unauthorized = requireApiSession(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ error: "证书 ID 不能为空" }, { status: 400 });

  const contents = await getCertificateContents(id);
  if (!contents) return NextResponse.json({ error: "证书不存在" }, { status: 404 });
  if (!contents.certificatePem) {
    return NextResponse.json({ error: "该证书没有可导出的内容" }, { status: 404 });
  }

  try {
    const storedCertificate = contents.certificatePem.trim();
    const certificateInput = storedCertificate.includes("-----BEGIN CERTIFICATE-----")
      ? storedCertificate
      : Buffer.from(storedCertificate.replace(/\s/g, ""), "base64");
    const x509 = new X509Certificate(certificateInput);
    const publicKeyPem = x509.publicKey.export({ type: "spki", format: "pem" }).toString();
    if (body.format === "zip") {
      if (!contents.privateKey) {
        return NextResponse.json({ error: "该证书没有可导出的私钥" }, { status: 422 });
      }
      const baseName = contents.primaryDomain.replace(/^\*\./, "wildcard.").replace(/[^a-zA-Z0-9._-]/g, "-");
      const zip = createZipArchive([
        { name: `${baseName}.public-key.pem`, data: publicKeyPem },
        { name: `${baseName}.private-key.pem`, data: contents.privateKey },
      ]);
      const zipBody = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer;
      return new NextResponse(zipBody, {
        headers: {
          "Cache-Control": "no-store, max-age=0",
          "Content-Disposition": `attachment; filename="${baseName}.keys.zip"`,
          "Content-Type": "application/zip",
        },
      });
    }
    return NextResponse.json(
      { data: { publicKeyPem, privateKey: contents.privateKey } },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch {
    return NextResponse.json({ error: "证书内容无法解析或导出" }, { status: 422 });
  }
}
