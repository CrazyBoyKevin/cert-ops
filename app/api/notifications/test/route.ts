import { NextResponse } from "next/server";
import { getNotificationSettings } from "@/lib/repository";
import { sendNotifications } from "@/lib/notifier";
import type { Certificate } from "@/lib/types";

export async function POST() {
  const settings = await getNotificationSettings();
  const mock: Certificate = {
    id: "test", name: "通知测试证书", primaryDomain: "test.certops.cn", domains: ["test.certops.cn"], issuer: "CertOps",
    validFrom: new Date().toISOString(), expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), serialNumber: "TEST",
    fingerprint: "TEST", algorithm: "RSA 2048", groupId: "test", createdAt: new Date().toISOString(), hasPrivateKey: false,
  };
  const results = await sendNotifications(settings, mock, 7);
  if (!results.length) return NextResponse.json({ error: "请至少启用并完整配置一个通知渠道" }, { status: 400 });
  const success = results.some((item) => item.success);
  return NextResponse.json({ results, success }, { status: success ? 200 : 502 });
}
