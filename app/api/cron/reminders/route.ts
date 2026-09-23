import { NextResponse } from "next/server";
import { runReminderCheck } from "@/lib/reminders";

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runReminderCheck(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "到期检查失败，请检查数据库连接和通知配置" }, { status: 503 });
  }
}
