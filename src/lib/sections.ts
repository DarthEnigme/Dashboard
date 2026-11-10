import { Clapperboard, ListTodo, Network, NotebookText, Plane, TrendingUp, Wallet, type LucideIcon } from "lucide-react";
import type { App, Permission } from "./config/schema";
import { msg } from "@/i18n";

/** A page of its own next to the dashboard (Finance, Travel…), shown to people with its permission. */
export interface AppSection {
  id: App;
  href: string;
  label: string;
  permission: App;
  icon: LucideIcon;
  /** Extra words the command palette matches. */
  keywords: string;
  /** What its permission lets someone do (Settings → Accounts → Groups). */
  blurb: string;
}

/**
 * Everything the interface knows about each app, in menu order. An app added to APPS fails to
 * compile until it is described here (and until its tables are listed in lib/modules.ts).
 */
const APP_DEFS: Record<App, Omit<AppSection, "id" | "href" | "permission">> = {
  finance: { label: msg("Finance"), icon: Wallet, keywords: "money budget spending accounts", blurb: msg("Use the finance tracker") },
  travel: { label: msg("Travel"), icon: Plane, keywords: "trips countries map globe voyage", blurb: msg("Use the travel log") },
  watchlist: { label: msg("Watchlist"), icon: Clapperboard, keywords: "books reading movies shows games films livres", blurb: msg("Use the watchlist and reading list") },
  stocks: { label: msg("Stocks"), icon: TrendingUp, keywords: "portfolio shares etf dividends bourse actions investing market", blurb: msg("Use the stock portfolio and research pages") },
  tasks: { label: msg("Tasks"), icon: ListTodo, keywords: "kanban board todo to-do list projects tâches", blurb: msg("Use the task boards") },
  notes: { label: msg("Notes"), icon: NotebookText, keywords: "runbook wiki docs how-to markdown procedures", blurb: msg("Read and write notes and runbooks") },
  inventory: { label: msg("Inventory"), icon: Network, keywords: "devices network ip mac warranty wake inventaire", blurb: msg("See and edit the device inventory (and wake devices, with actions)") },
};

export const APP_SECTIONS: AppSection[] = (Object.keys(APP_DEFS) as App[]).map((id) => ({ id, href: `/${id}`, permission: id, ...APP_DEFS[id] }));

/** What each permission lets someone do: the apps', and the one that isn't an app. */
export const PERMISSION_BLURBS: Record<Permission, string> = {
  actions: msg("Run widget actions (start, stop, restart)"),
  ...(Object.fromEntries(APP_SECTIONS.map((s) => [s.id, s.blurb])) as Record<App, string>),
};

export const sectionsFor = (permissions: readonly string[] = []) => APP_SECTIONS.filter((s) => permissions.includes(s.permission));
