import { createHmac } from "node:crypto";
import nodemailer from "nodemailer";
import type { Certificate, NotificationSettings } from "./types";

type ChannelResult = { channel: "dingtalk" | "feishu" | "email"; success: boolean; detail: string };

function messageFor(certificate: Certificate, days: number) {
  const expiry = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(certificate.expiresAt));
  return `证书 ${certificate.primaryDomain} 将在 ${days} 天后到期（${expiry}），请及时确认续期与部署状态。`;
}

type BotChannel = "dingtalk" | "feishu";
type BotResponse = { errcode?: number; errmsg?: string; code?: number; msg?: string; StatusCode?: number; StatusMessage?: string };

async function postJson(url: string, body: unknown, channel: BotChannel) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const raw = await response.text();
  let result: BotResponse = {};
  try { result = JSON.parse(raw) as BotResponse; } catch { /* A non-JSON error is handled by HTTP status below. */ }
  if (!response.ok) throw new Error(`HTTP ${response.status}${result.errmsg || result.msg ? `: ${result.errmsg || result.msg}` : ""}`);

  if (channel === "dingtalk" && typeof result.errcode === "number" && result.errcode !== 0) {
    throw new Error(`钉钉错误 ${result.errcode}: ${result.errmsg || "发送失败"}`);
  }
  if (channel === "feishu") {
    if (typeof result.code === "number" && result.code !== 0) throw new Error(`飞书错误 ${result.code}: ${result.msg || "发送失败"}`);
    if (typeof result.StatusCode === "number" && result.StatusCode !== 0) throw new Error(`飞书错误 ${result.StatusCode}: ${result.StatusMessage || "发送失败"}`);
  }
  return "已发送";
}

function signedDingtalkWebhook(webhook: string, secret: string) {
  if (!secret) return webhook;
  const timestamp = Date.now().toString();
  const sign = createHmac("sha256", secret).update(`${timestamp}\n${secret}`).digest("base64");
  const url = new URL(webhook);
  url.searchParams.set("timestamp", timestamp);
  url.searchParams.set("sign", sign);
  return url.toString();
}

export function signedFeishuPayload<T extends Record<string, unknown>>(body: T, secret: string, now = Date.now()) {
  if (!secret) return body;
  const timestamp = Math.floor(now / 1000).toString();
  const stringToSign = `${timestamp}\n${secret}`;
  const sign = createHmac("sha256", stringToSign).update("").digest("base64");
  return { ...body, timestamp, sign };
}

export async function sendNotifications(settings: NotificationSettings, certificate: Certificate, days: number) {
  const text = messageFor(certificate, days);
  const jobs: Promise<ChannelResult>[] = [];

  if (settings.dingtalkEnabled && settings.dingtalkWebhook) {
    jobs.push(postJson(signedDingtalkWebhook(settings.dingtalkWebhook, settings.dingtalkSecret), { msgtype: "text", text: { content: `【CertOps 到期提醒】\n${text}` } }, "dingtalk")
      .then((detail) => ({ channel: "dingtalk" as const, success: true, detail }))
      .catch((error) => ({ channel: "dingtalk" as const, success: false, detail: String(error.message || error) })));
  }
  if (settings.feishuEnabled && settings.feishuWebhook) {
    const payload = signedFeishuPayload({ msg_type: "text", content: { text: `【CertOps 到期提醒】\n${text}` } }, settings.feishuSecret);
    jobs.push(postJson(settings.feishuWebhook, payload, "feishu")
      .then((detail) => ({ channel: "feishu" as const, success: true, detail }))
      .catch((error) => ({ channel: "feishu" as const, success: false, detail: String(error.message || error) })));
  }
  if (settings.emailEnabled && settings.smtpHost && settings.emailRecipients) {
    jobs.push((async () => {
      try {
        const transport = nodemailer.createTransport({
          host: settings.smtpHost,
          port: settings.smtpPort,
          secure: settings.smtpSecure,
          auth: settings.smtpUser ? { user: settings.smtpUser, pass: settings.smtpPassword } : undefined,
        });
        await transport.sendMail({
          from: settings.emailFrom || settings.smtpUser,
          to: settings.emailRecipients.split(/[,;\s]+/).filter(Boolean),
          subject: `[CertOps] ${certificate.primaryDomain} 将在 ${days} 天后到期`,
          text,
          html: `<div style="font-family:Arial,sans-serif;max-width:560px;padding:28px;color:#172033"><h2 style="margin:0 0 18px">SSL 证书到期提醒</h2><p style="line-height:1.7">${text}</p><p style="color:#697386;font-size:13px">来自 CertOps 证书管理平台</p></div>`,
        });
        return { channel: "email" as const, success: true, detail: "已发送" };
      } catch (error) {
        return { channel: "email" as const, success: false, detail: String(error instanceof Error ? error.message : error) };
      }
    })());
  }

  return Promise.all(jobs);
}
