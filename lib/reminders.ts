import { withReminderStore } from "./repository";
import { deliverReminders } from "./reminder-runner";
import { sendNotifications } from "./notifier";

export async function runReminderCheck() {
  const result = await withReminderStore((store) => deliverReminders(store, sendNotifications));
  return result ?? { checkedAt: new Date().toISOString(), deliveries: [], skipped: "another-check-running" };
}

const scheduler = globalThis as typeof globalThis & { certOpsReminderTimer?: ReturnType<typeof setTimeout>; certOpsReminderStarted?: boolean };

export function startReminderScheduler() {
  if (scheduler.certOpsReminderStarted) return;
  scheduler.certOpsReminderStarted = true;
  const interval = 10 * 60 * 1000;
  console.info("[CertOps reminders] Scheduler started; checking now and every 10 minutes.");
  const tick = async () => {
    try {
      const result = await runReminderCheck();
      const results = result.deliveries.flatMap((delivery) => delivery.results);
      console.info(`[CertOps reminders] Check completed: sent=${results.filter((item) => item.success).length}, failed=${results.filter((item) => !item.success).length}${"skipped" in result ? ", skipped=another-check-running" : ""}`);
    } catch {
      // Do not log connection strings, webhook URLs, or other notification credentials.
      console.error("[CertOps reminders] Check failed; verify database connectivity and notification configuration. Retrying in 10 minutes.");
    } finally {
      scheduler.certOpsReminderTimer = setTimeout(tick, interval);
      scheduler.certOpsReminderTimer.unref();
    }
  };
  void tick();
}
