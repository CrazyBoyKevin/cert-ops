export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { startReminderScheduler } = await import("./lib/reminders");
    startReminderScheduler();
    const { startAcmeScheduler } = await import("./lib/acme-worker");
    startAcmeScheduler();
  }
}
