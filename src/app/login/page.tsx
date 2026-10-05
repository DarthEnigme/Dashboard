import { redirect } from "next/navigation";
import { loadConfig } from "@/lib/config/load";
import { clientAuth } from "@/lib/auth";
import { Background } from "@/components/Background";
import { LoginForm } from "@/components/auth/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const auth = await clientAuth();
  if (auth.needsSetup) redirect("/setup");
  if (auth.user) redirect("/");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { alerts, docker, auth: _a, ...settings } = loadConfig().settings;
  const { error } = await searchParams;
  return (
    <>
      <Background settings={settings} />
      <main className="grid min-h-dvh place-items-center px-4 py-10">
        <LoginForm title={settings.title} methods={auth.methods} error={error} canGoBack={auth.publicView} />
      </main>
    </>
  );
}
