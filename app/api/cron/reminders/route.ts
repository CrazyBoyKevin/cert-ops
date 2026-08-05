import { NextResponse } from "next/server";
import { dueCertificates, getNotificationSettings } from "@/lib/repository";
import { sendNotifications } from "@/lib/notifier";

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const settings = await getNotificationSettings();
  const due = await dueCertificates();
  const deliveries = await Promise.all(due.map(async ({ certificate, days }) => ({
    certificate: certificate.primaryDomain,
    days,
    results: await sendNotifications(settings, certificate, days),
  })));
  return NextResponse.json({ checkedAt: new Date().toISOString(), deliveries });
}
