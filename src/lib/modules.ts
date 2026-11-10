import { loadConfig } from "./config/load";
import type { App } from "./config/schema";
import { db } from "./db";

/**
 * The database tables each app owns, children before parents so they can be emptied in this order
 * without tripping a foreign key. Adding an app to APPS fails to compile until it is listed here.
 */
export const MODULE_TABLES = {
  finance: ["fin_goal_moves", "fin_goals", "fin_transactions", "fin_recurring", "fin_shortcuts", "fin_rules", "fin_categories", "fin_accounts", "fin_meta"],
  travel: ["travel_stops", "travel_companions", "travel_trips", "travel_places"],
  watchlist: ["watch_items", "watch_sync"],
  inventory: ["devices"],
  notes: ["note_services", "notes"],
  tasks: ["tasks", "task_columns", "task_boards"],
  stocks: ["stock_transactions", "stock_portfolios", "stock_watch", "stock_cache"],
} as const satisfies Record<App, readonly string[]>;

export const appEnabled = (app: App) => loadConfig().settings.apps.includes(app);

/** An hourly job that does nothing while its app is turned off. */
export const whenEnabled =
  <A extends unknown[]>(app: App, job: (...args: A) => Promise<unknown>) =>
  async (...args: A) => {
    if (appEnabled(app)) await job(...args);
  };

export const hasData = (app: App) => MODULE_TABLES[app].some((t) => db().prepare(`SELECT 1 FROM ${t} LIMIT 1`).get() !== undefined);
