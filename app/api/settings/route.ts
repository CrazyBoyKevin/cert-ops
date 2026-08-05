import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { getNotificationSettings, saveNotificationSettings } from "@/lib/repository";
import type { NotificationSettings } from "@/lib/types";

const MASK = "••••••••";

function publicSettings(settings: NotificationSettings) {
  return {
    ...settings,
    dingtalkWebhook: settings.dingtalkWebhook ? MASK : "",
    dingtalkSecret: settings.dingtalkSecret ? MASK : "",
    feishuWebhook: settings.feishuWebhook ? MASK : "",
    feishuSecret: settings.feishuSecret ? MASK : "",
    smtpPassword: settings.smtpPassword ? MASK : "",
  };
}

export async function GET(request: Request) {
  const unauthorized = requireApiSession(request);
  if (unauthorized) return unauthorized;
  return NextResponse.json({ data: publicSettings(await getNotificationSettings()) });
}

export async function PUT(request: Request) {
  const unauthorized = requireApiSession(request);
  if (unauthorized) return unauthorized;
  const current = await getNotificationSettings();
  const body = await request.json().catch(() => ({}));
  const settings: NotificationSettings = {
    dingtalkEnabled: Boolean(body.dingtalkEnabled),
    dingtalkWebhook: body.dingtalkWebhook === MASK ? current.dingtalkWebhook : String(body.dingtalkWebhook || ""),
    dingtalkSecret: body.dingtalkSecret === MASK ? current.dingtalkSecret : String(body.dingtalkSecret || ""),
    feishuEnabled: Boolean(body.feishuEnabled),
    feishuWebhook: body.feishuWebhook === MASK ? current.feishuWebhook : String(body.feishuWebhook || ""),
    feishuSecret: body.feishuSecret === MASK ? current.feishuSecret : String(body.feishuSecret || ""),
    emailEnabled: Boolean(body.emailEnabled),
    smtpHost: String(body.smtpHost || ""),
    smtpPort: Number(body.smtpPort) || 465,
    smtpSecure: Boolean(body.smtpSecure),
    smtpUser: String(body.smtpUser || ""),
    smtpPassword: body.smtpPassword === MASK ? current.smtpPassword : String(body.smtpPassword || ""),
    emailFrom: String(body.emailFrom || ""),
    emailRecipients: String(body.emailRecipients || ""),
  };
  if (settings.dingtalkEnabled && !settings.dingtalkWebhook) return NextResponse.json({ error: "请填写钉钉机器人 Webhook" }, { status: 400 });
  if (settings.feishuEnabled && !settings.feishuWebhook) return NextResponse.json({ error: "请填写飞书机器人 Webhook" }, { status: 400 });
  if (settings.emailEnabled && (!settings.smtpHost || !settings.emailRecipients)) return NextResponse.json({ error: "请完善邮件服务器与收件人信息" }, { status: 400 });
  await saveNotificationSettings(settings);
  return NextResponse.json({ data: publicSettings(settings) });
}
