import type { Certificate, NotificationSettings } from "./types";

export type ReminderChannel = "dingtalk" | "feishu" | "email";
export type ReminderResult = { channel: ReminderChannel; success: boolean; detail: string };
export type ReminderStore = {
  settings(): Promise<NotificationSettings>;
  certificates(): Promise<Certificate[]>;
  wasSent(id: string, days: number, channel: ReminderChannel): Promise<boolean>;
  record(id: string, days: number, result: ReminderResult): Promise<void>;
};

export function reminderDays(expiresAt: string, now: number) {
  const days = Math.ceil((new Date(expiresAt).getTime() - now) / 86_400_000);
  return [15, 7, 3, 1].includes(days) ? days : null;
}

export async function deliverReminders(
  store: ReminderStore,
  send: (settings: NotificationSettings, certificate: Certificate, days: number) => Promise<ReminderResult[]>,
  now = Date.now(),
) {
  const settings = await store.settings();
  const deliveries = [];
  for (const certificate of await store.certificates()) {
    const days = reminderDays(certificate.expiresAt, now);
    if (days === null) continue;
    const pending = { ...settings };
    for (const channel of ["dingtalk", "feishu", "email"] as const) {
      if (await store.wasSent(certificate.id, days, channel)) pending[`${channel}Enabled`] = false;
    }
    const results = await send(pending, certificate, days);
    for (const result of results) await store.record(certificate.id, days, result);
    if (results.length) deliveries.push({ certificate: certificate.primaryDomain, days, results });
  }
  return { checkedAt: new Date(now).toISOString(), deliveries };
}
