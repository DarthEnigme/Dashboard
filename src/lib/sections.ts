import { Clapperboard, Network, Plane, Wallet, type LucideIcon } from "lucide-react";
import type { Permission } from "./config/schema";
import { msg } from "@/i18n";

/** A page of its own next to the dashboard (Finance, Travel…), shown to people with its permission. */
export interface AppSection {
  id: string;
  href: string;
  label: string;
  permission: Permission;
  icon: LucideIcon;
  /** Extra words the command palette matches. */
  keywords: string;
}

export const APP_SECTIONS: AppSection[] = [
  { id: "finance", href: "/finance", label: msg("Finance"), permission: "finance", icon: Wallet, keywords: "money budget spending accounts" },
  { id: "travel", href: "/travel", label: msg("Travel"), permission: "travel", icon: Plane, keywords: "trips countries map globe voyage" },
  { id: "watchlist", href: "/watchlist", label: msg("Watchlist"), permission: "watchlist", icon: Clapperboard, keywords: "books reading movies shows games films livres" },
  { id: "inventory", href: "/inventory", label: msg("Inventory"), permission: "inventory", icon: Network, keywords: "devices network ip mac warranty wake inventaire" },
];

export const sectionsFor = (permissions: readonly string[] = []) => APP_SECTIONS.filter((s) => permissions.includes(s.permission));
