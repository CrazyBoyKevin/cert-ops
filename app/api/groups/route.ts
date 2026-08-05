import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { createGroup, deleteGroup, listGroups, updateGroup } from "@/lib/repository";

export async function GET(request: Request) {
  const unauthorized = requireApiSession(request);
  if (unauthorized) return unauthorized;
  return NextResponse.json(await listGroups());
}

export async function POST(request: Request) {
  const unauthorized = requireApiSession(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  if (!name || name.length > 80) return NextResponse.json({ error: "请输入 1–80 个字符的分组名称" }, { status: 400 });
  try {
    return NextResponse.json({ data: await createGroup(name) }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "分组名称已存在" }, { status: 409 });
  }
}

export async function PATCH(request: Request) {
  const unauthorized = requireApiSession(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  const name = String(body.name || "").trim();
  if (!id) return NextResponse.json({ error: "分组 ID 不能为空" }, { status: 400 });
  if (!name || name.length > 80) return NextResponse.json({ error: "请输入 1–80 个字符的分组名称" }, { status: 400 });
  try {
    const group = await updateGroup(id, name);
    return group
      ? NextResponse.json({ data: group })
      : NextResponse.json({ error: "分组不存在" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "分组名称已存在" }, { status: 409 });
  }
}

export async function DELETE(request: Request) {
  const unauthorized = requireApiSession(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ error: "分组 ID 不能为空" }, { status: 400 });

  const result = await deleteGroup(id);
  if (result === "deleted") return NextResponse.json({ ok: true });
  if (result === "not_empty") {
    return NextResponse.json({ error: "分组内仍有证书，无法删除" }, { status: 409 });
  }
  return NextResponse.json({ error: "分组不存在" }, { status: 404 });
}
