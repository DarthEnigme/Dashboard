export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { startMonitor, onHourly } = await import("./lib/monitor");
    const { fireflyDailyJob } = await import("./lib/finance/firefly");
    const { budgetAlertJob } = await import("./lib/finance/budgets");
    const { recurringJob, subscriptionReminderJob } = await import("./lib/finance/recurring");
    const { pruneSessions } = await import("./lib/auth/sessions");
    const { pruneAudit } = await import("./lib/auth/users");
    const { updateJob } = await import("./lib/update/job");
    const { backupJob } = await import("./lib/backup");
    const { warrantyJob } = await import("./lib/inventory/store");
    const { watchSyncJob } = await import("./lib/watchlist/sync");
    const { reconcilePendingUpdate } = await import("./lib/update/apply");
    try {
      reconcilePendingUpdate();
    } catch (e) {
      console.warn("[nanodash] could not record the last update:", e);
    }
    startMonitor();
    onHourly(fireflyDailyJob);
    onHourly(recurringJob);
    onHourly(() => subscriptionReminderJob());
    onHourly(budgetAlertJob);
    onHourly(updateJob);
    onHourly(backupJob);
    onHourly(warrantyJob);
    onHourly(() => watchSyncJob());
    onHourly(async () => void pruneSessions());
    onHourly(async () => void pruneAudit());
  }
}
