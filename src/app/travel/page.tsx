import { redirect } from "next/navigation";
import { loadConfig } from "@/lib/config/load";
import { clientAuth } from "@/lib/auth";
import { Background } from "@/components/Background";
import { TravelPage } from "@/components/travel/TravelPage";

export const dynamic = "force-dynamic";

export default async function Travel() {
  const auth = await clientAuth();
  if (!auth.user) redirect(auth.needsSetup ? "/setup" : "/login");
  if (!auth.user.permissions.includes("travel")) redirect("/");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { alerts, docker, auth: _a, ...settings } = loadConfig().settings;
  return (
    <>
      <Background settings={settings} />
      <TravelPage colors={{ visited: settings.travel.visitedColor, lived: settings.travel.livedColor, want: settings.travel.wantColor }} />
    </>
  );
}
