import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto-store";
import { parseCertificate } from "@/lib/certificate";
import { createCertificate, deleteCertificate, listCertificates, updateCertificate } from "@/lib/repository";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = requireApiSession(request);
  if (unauthorized) return unauthorized;
  const result = await listCertificates();
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const unauthorized = requireApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const form = await request.formData();
    const certificateText = String(form.get("certificateText") || "").trim();
    const privateKeyText = String(form.get("privateKeyText") || "").trim();
    const certificateFile = form.get("certificateFile");
    const privateKeyFile = form.get("privateKeyFile");
    const groupId = String(form.get("groupId") || "");

    let certificateInput: string | Buffer = certificateText;
    if (!certificateText && certificateFile instanceof File && certificateFile.size) {
      certificateInput = Buffer.from(await certificateFile.arrayBuffer());
    }
    let privateKey = privateKeyText;
    if (!privateKey && privateKeyFile instanceof File && privateKeyFile.size) {
      privateKey = Buffer.from(await privateKeyFile.arrayBuffer()).toString("utf8");
    }
    if (!certificateInput || (typeof certificateInput === "string" && !certificateInput.trim())) {
      return NextResponse.json({ error: "请粘贴证书内容或选择证书文件" }, { status: 400 });
    }
    if (!groupId) return NextResponse.json({ error: "请选择证书所属分组" }, { status: 400 });

    const parsed = parseCertificate(certificateInput, privateKey || undefined);
    const name = String(form.get("name") || "").trim() || parsed.primaryDomain;
    const certificateBufferText = typeof certificateInput === "string" ? certificateInput : certificateInput.toString("utf8");
    const certificatePem = certificateBufferText.includes("-----BEGIN CERTIFICATE-----")
      ? certificateBufferText.trim()
      : `-----BEGIN CERTIFICATE-----\n${Buffer.from(certificateInput).toString("base64").match(/.{1,64}/g)?.join("\n") || ""}\n-----END CERTIFICATE-----`;
    const result = await createCertificate({
      ...parsed,
      name,
      groupId,
      certificatePem,
      privateKeyEncrypted: privateKey ? encryptSecret(privateKey.trim()) : "",
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "证书解析失败";
    return NextResponse.json({ error: message.includes("error:") ? "证书格式无效，请确认内容完整" : message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const unauthorized = requireApiSession(request);
  if (unauthorized) return unauthorized;
  const { id, confirmed } = await request.json().catch(() => ({}));
  if (!id || confirmed !== true) return NextResponse.json({ error: "删除操作需要明确确认" }, { status: 400 });
  const deleted = await deleteCertificate(String(id));
  return deleted ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "证书不存在" }, { status: 404 });
}

export async function PATCH(request: Request) {
  const unauthorized = requireApiSession(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  const name = String(body.name || "").trim();
  const groupId = String(body.groupId || "");
  if (!id) return NextResponse.json({ error: "证书 ID 不能为空" }, { status: 400 });
  if (!name || name.length > 180) return NextResponse.json({ error: "证书名称长度应为 1–180 个字符" }, { status: 400 });
  if (!groupId) return NextResponse.json({ error: "请选择证书所属分组" }, { status: 400 });
  const result = await updateCertificate(id, name, groupId);
  return result ? NextResponse.json(result) : NextResponse.json({ error: "证书或分组不存在" }, { status: 404 });
}
