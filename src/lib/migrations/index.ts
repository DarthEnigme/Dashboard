import type { DatabaseSync } from "node:sqlite";
import { baseline } from "./001-baseline";
import { tasksAndStocks } from "./002-tasks-and-stocks";
import { taskProjects } from "./003-task-projects";
import { stockAlertsAndBrokers } from "./004-stock-alerts-and-brokers";

/**
 * Schema steps, in order: step i brings the database from user_version i to i + 1, in one transaction.
 * Never change a released step (installs that ran it won't run it again): add a new one at the end,
 * in its own numbered file, so two branches taking the same number meet as a merge conflict here.
 */
export const MIGRATIONS: ((d: DatabaseSync) => void)[] = [
  // 1: everything up to 0.5.11. Idempotent, so databases made before versioning pass through it.
  baseline,
  // 2: the Tasks and Stocks apps.
  tasksAndStocks,
  // 3: Tasks: lanes, dependencies, project mode and reminders.
  taskProjects,
  // 4: Stocks: alerts, broker connections, logos, and ids that keep imports from doubling.
  stockAlertsAndBrokers,
];
