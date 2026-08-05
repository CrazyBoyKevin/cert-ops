import { NextResponse } from "next/server";
import { getRequestSession, requireApiSession } from "@/lib/auth";

export async function GET(request: Request) {
  const unauthorized = requireApiSession(request);
  if (unauthorized) return unauthorized;
  const session = getRequestSession(request)!;
  return NextResponse.json(
    { data: { username: session.username } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
