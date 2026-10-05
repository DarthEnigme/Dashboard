import { redirect } from "next/navigation";
import { loadConfig } from "@/lib/config/load";
import { clientAuth } from "@/lib/auth";
import { Background } from "@/components/Background";
import { SetupForm } from "@/components/auth/SetupForm";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const auth = await clientAuth();
  if (!auth.needsSetup) redirect(auth.user ? "/" : "/login");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { alerts, docker, auth: _a, ...settings } = loadConfig().settings;
  return (
    <>
      <Background settings={settings} />
      <main className="grid min-h-dvh place-items-center px-4 py-10">
        <SetupForm title={settings.title} />
      </main>
    </>
  );
}
