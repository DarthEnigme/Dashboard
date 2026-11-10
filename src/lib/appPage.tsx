import type { ReactElement } from "react";
import { redirect } from "next/navigation";
import { loadConfig } from "@/lib/config/load";
import type { Settings } from "@/lib/config/schema";
import { clientAuth, type ClientAuth } from "@/lib/auth";
import { personal } from "@/lib/userLook";
import { Background } from "@/components/Background";
import type { App } from "@/lib/config/schema";

interface Shell {
  user: NonNullable<ClientAuth["user"]>;
  settings: Settings;
  /** The page background in this person's look: render it before the app. */
  background: ReactElement;
}

/**
 * What every app page starts with: the signed-in person (sent to sign in, or home when they
 * lack the app's permission), the settings, and the background.
 */
export async function appShell(app: App): Promise<Shell> {
  const auth = await clientAuth();
  if (!auth.user) redirect(auth.needsSetup ? "/setup" : "/login");
  if (!auth.user.permissions.includes(app)) redirect("/");
  const { settings } = loadConfig();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { alerts, docker, auth: _a, ...look } = settings;
  return { user: auth.user, settings, background: <Background settings={await personal(look)} /> };
}
