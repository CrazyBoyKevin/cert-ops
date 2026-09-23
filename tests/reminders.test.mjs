import assert from "node:assert/strict";
import test from "node:test";
import { deliverReminders, reminderDays } from "../lib/reminder-runner.ts";

const now = Date.parse("2026-09-09T12:00:00Z");
const day = 86_400_000;

test("reminder windows use remaining time, including midnight and expiry boundaries", () => {
  for (const days of [15, 7, 3, 1]) {
    assert.equal(reminderDays(new Date(now + days * day).toISOString(), now), days);
    assert.equal(reminderDays(new Date(now + days * day + 1).toISOString(), now), null);
  }
  assert.equal(reminderDays(new Date(now).toISOString(), now), null);
  assert.equal(reminderDays(new Date(now - 1).toISOString(), now), null);
  assert.equal(reminderDays("invalid", now), null);
  assert.equal(reminderDays("2026-09-10T00:00:00Z", now), 1);
});

test("successful channels are deduplicated across runs; only failed channels retry", async () => {
  const records = new Map();
  const cert = { id: "cert-1", primaryDomain: "example.com", expiresAt: new Date(now + 7 * day).toISOString() };
  const settings = { dingtalkEnabled: true, feishuEnabled: true, emailEnabled: false };
  const store = {
    settings: async () => settings,
    certificates: async () => [cert, { ...cert, id: "not-due", expiresAt: new Date(now + 20 * day).toISOString() }],
    wasSent: async (id, days, channel) => records.get(`${id}:${days}:${channel}`)?.success === true,
    record: async (id, days, result) => records.set(`${id}:${days}:${result.channel}`, result),
  };
  const attempts = [];
  const send = async (pending) => {
    attempts.push({ ...pending });
    return ["dingtalk", "feishu", "email"].filter((channel) => pending[`${channel}Enabled`]).map((channel) => ({
      channel, success: channel !== "feishu" || attempts.length > 1, detail: "test",
    }));
  };
  await deliverReminders(store, send, now);
  await deliverReminders(store, send, now + 10 * 60_000);
  const last = await deliverReminders(store, send, now + 20 * 60_000);
  assert.equal(attempts[0].dingtalkEnabled, true);
  assert.equal(attempts[1].dingtalkEnabled, false);
  assert.equal(attempts[1].feishuEnabled, true);
  assert.equal(attempts[2].feishuEnabled, false);
  assert.deepEqual(last.deliveries, []);
  assert.equal(settings.dingtalkEnabled, true);
  assert.equal(records.size, 2);
});

test("storage failure stops delivery instead of sending untracked demo notifications", async () => {
  let sent = false;
  await assert.rejects(deliverReminders({ settings: async () => { throw new Error("offline"); } }, async () => { sent = true; return []; }, now), /offline/);
  assert.equal(sent, false);
});
