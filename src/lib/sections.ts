import { Plane, Wallet, type LucideIcon } from "lucide-react";
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
];

export const sectionsFor = (permissions: readonly string[] = []) => APP_SECTIONS.filter((s) => permissions.includes(s.permission));
