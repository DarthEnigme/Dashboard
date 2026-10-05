import { redirect } from "next/navigation";
import { loadConfig, readRaw } from "@/lib/config/load";
import { maskRaw, sanitize } from "@/lib/config/sanitize";
import { canEdit, clientAuth } from "@/lib/auth";
import { configVersion } from "@/lib/config/watch";
import { SettingsApp } from "@/components/settings/SettingsApp";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings" };

export default async function Settings() {
  if (!(await canEdit())) {
    const auth = await clientAuth();
    redirect(auth.user ? "/" : auth.needsSetup ? "/setup" : "/login");
  }
  const version = configVersion();
  const initial = (maskRaw("settings", readRaw("settings")) ?? {}) as Record<string, unknown>;
  return <SettingsApp initial={initial} fallback={sanitize(loadConfig()).settings} version={version} />;
}
