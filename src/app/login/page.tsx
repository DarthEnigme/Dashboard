import { redirect } from "next/navigation";
import { loadConfig } from "@/lib/config/load";
import { clientAuth } from "@/lib/auth";
import { Background } from "@/components/Background";
import { LoginForm } from "@/components/auth/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; local?: string }> }) {
  const auth = await clientAuth();
  if (auth.needsSetup) redirect("/setup");
  if (auth.user) redirect("/");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { alerts, docker, auth: _a, ...settings } = loadConfig().settings;
  const { error, local } = await searchParams;
  const { login } = settings;
  // Straight to the identity provider, unless something went wrong there or the page is asked for (/login?local=1).
  if (login.autoRedirect && !error && local !== "1" && auth.methods.providers.some((p) => p.id === login.autoRedirect)) redirect(`/api/auth/oauth/${login.autoRedirect}/start`);
  const background = login.background?.trim() ? { ...settings, background: { ...settings.background, image: login.background } } : settings;
  return (
    <>
      <Background settings={background} />
      <main className="grid min-h-dvh place-items-center px-4 py-10">
        <LoginForm
          title={settings.title}
          logo={settings.logo}
          methods={auth.methods}
          error={error}
          canGoBack={auth.publicView && login.backLink}
          heading={login.heading}
          message={login.message}
          footer={login.footer}
          passwordForm={login.passwordForm}
        />
      </main>
    </>
  );
}
