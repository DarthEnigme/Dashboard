export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { startMonitor, onEvery, onHourly } = await import("./lib/monitor");
    const { fireflyDailyJob } = await import("./lib/finance/firefly");
    const { budgetAlertJob } = await import("./lib/finance/budgets");
    const { recurringJob, subscriptionReminderJob } = await import("./lib/finance/recurring");
    const { pruneSessions } = await import("./lib/auth/sessions");
    const { pruneAudit } = await import("./lib/auth/users");
    const { updateJob } = await import("./lib/update/job");
    const { backupJob } = await import("./lib/backup");
    const { warrantyJob } = await import("./lib/inventory/store");
    const { taskReminderJob } = await import("./lib/tasks/reminders");
    const { watchSyncJob } = await import("./lib/watchlist/sync");
    const { pruneStockCache } = await import("./lib/stocks/cache");
    const { stockAlertJob } = await import("./lib/stocks/alertJob");
    const { brokerSyncJob } = await import("./lib/stocks/brokers/sync");
    const { loadConfig } = await import("./lib/config/load");
    const { whenEnabled } = await import("./lib/modules");
    const { reconcileModules } = await import("./lib/module-retention");
    const { announceUpdateOutcome, reconcilePendingUpdate } = await import("./lib/update/apply");
    type App = import("./lib/config/schema").App;
    try {
      const outcome = reconcilePendingUpdate();
      if (outcome) void announceUpdateOutcome(outcome).catch((e) => console.warn("[nanodash] could not send the update notice:", e));
    } catch (e) {
      console.warn("[nanodash] could not record the last update:", e);
    }
    startMonitor();

    /** Each app's background jobs: hourly, unless `every` says how often (in ms, read each time). */
    type Job = { run: () => Promise<unknown>; every?: () => number };
    const APP_JOBS: Record<App, Job[]> = {
      finance: [{ run: fireflyDailyJob }, { run: recurringJob }, { run: () => subscriptionReminderJob() }, { run: budgetAlertJob }],
      travel: [],
      watchlist: [{ run: () => watchSyncJob() }],
      inventory: [{ run: () => warrantyJob() }],
      notes: [],
      tasks: [{ run: () => taskReminderJob() }],
      stocks: [{ run: () => pruneStockCache() }, { run: () => brokerSyncJob() }, { run: () => stockAlertJob(), every: () => loadConfig().settings.stocks.alertMinutes * 60_000 }],
    };
    // An app's jobs sleep while it is turned off.
    for (const [app, jobs] of Object.entries(APP_JOBS) as [App, Job[]][]) {
      for (const job of jobs) {
        const run = whenEnabled(app, job.run);
        if (job.every) onEvery(job.every, run);
        else onHourly(run);
      }
    }

    onHourly(updateJob);
    onHourly(backupJob);
    onHourly(async () => reconcileModules());
    onHourly(async () => void pruneSessions());
    onHourly(async () => void pruneAudit());
  }
}
