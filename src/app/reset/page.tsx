import { loadConfig } from "@/lib/config/load";
import { Background } from "@/components/Background";
import { ResetForm } from "@/components/auth/ResetForm";

export const dynamic = "force-dynamic";

/** Where an admin's one-time link lands: set a password, then sign in. */
export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { alerts, docker, auth: _a, ...settings } = loadConfig().settings;
  const { token = "" } = await searchParams;
  return (
    <>
      <Background settings={settings} />
      <main className="grid min-h-dvh place-items-center px-4 py-10">
        <ResetForm title={settings.title} token={token} />
      </main>
    </>
  );
}
