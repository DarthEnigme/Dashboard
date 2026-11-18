import { redirect } from "next/navigation";
import { KeyRound, ListTodo } from "lucide-react";
import { loadConfig } from "@/lib/config/load";
import { pageOrigin, viewer } from "@/lib/auth";
import { checkAuthorize } from "@/lib/oauth/server";
import { getT } from "@/i18n/server";
import { Background } from "@/components/Background";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
/** One value per parameter: a repeated one is refused by checkAuthorize as missing. */
const single = (p: Params) => Object.fromEntries(Object.entries(p).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))) as Record<string, string>;

const button = "flex h-10 flex-1 items-center justify-center rounded-xl text-sm font-semibold transition";

/**
 * OAuth consent: an app (claude.ai's connector, an MCP client) asks to manage the signed-in person's
 * task boards. Signed out: sign in first and come back. Yes or no is posted to /api/oauth/authorize.
 */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = single(await searchParams);
  const origin = await pageOrigin();
  const t = await getT();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { alerts, docker, auth: _a, ...settings } = loadConfig().settings;

  const checked = checkAuthorize(params, origin);
  if ("redirect" in checked) redirect(checked.redirect);

  const card = (children: React.ReactNode) => (
    <>
      <Background settings={settings} />
      <main className="grid min-h-dvh place-items-center px-4 py-10">
        <div className="glass w-full max-w-md rounded-3xl p-7">
          {settings.logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={settings.logo} alt="" className="mb-4 h-14 w-14 rounded-2xl object-contain" />
          )}
          {children}
        </div>
      </main>
    </>
  );

  if ("fatal" in checked) {
    return card(
      <>
        <h1 className="mb-3 text-2xl font-bold tracking-tight">{t("Can't connect this app")}</h1>
        <p role="alert" className="rounded-xl bg-[var(--err)]/15 px-3 py-2 text-sm text-[var(--err)]">
          {t(checked.fatal)}
        </p>
      </>,
    );
  }

  const who = await viewer();
  if (!who.user) redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${new URLSearchParams(params)}`)}`);
  const { client, redirectUri, state, challenge } = checked.ok;
  const canUse = who.permissions.includes("tasks");
  const fields = { client_id: client.client_id, redirect_uri: redirectUri, state, code_challenge: challenge, code_challenge_method: "S256", response_type: "code", scope: params.scope, resource: params.resource };
  const target = (() => {
    const u = new URL(redirectUri);
    return u.protocol === "http:" || u.protocol === "https:" ? u.host : u.protocol.replace(/:$/, "");
  })();

  return card(
    <form method="post" action="/api/oauth/authorize" className="flex flex-col gap-4">
      {Object.entries(fields).map(([k, v]) => v !== undefined && <input key={k} type="hidden" name={k} value={v} />)}
      <h1 className="text-2xl font-bold tracking-tight">{t("Allow {app} to manage your tasks?", { app: client.name })}</h1>
      <p className="text-sm text-muted">{t("Signed in to {title} as {user}.", { title: settings.title, user: who.user.name || who.user.username })}</p>
      {canUse ? (
        <>
          <ul className="flex flex-col gap-2 text-sm">
            <li className="flex gap-2">
              <ListTodo className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              {t("It can read, add, change, move and delete the tasks on your boards. Nothing else on the dashboard.")}
            </li>
            <li className="flex gap-2">
              <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              {t("It keeps access until you revoke it, under Tasks → Connect Claude.")}
            </li>
          </ul>
          <p className="text-xs text-muted">
            {t("After you answer, you go back to")} <span className="font-mono text-fg">{target}</span>. {t("Only allow apps you've just connected yourself.")}
          </p>
        </>
      ) : (
        <p role="alert" className="rounded-xl bg-[var(--err)]/15 px-3 py-2 text-sm text-[var(--err)]">
          {t("You don't have access to the task boards. Ask an admin.")}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <button type="submit" name="decision" value="deny" className={`${button} bg-chip text-fg hover:bg-hover`}>
          {canUse ? t("Deny") : t("Back to the app")}
        </button>
        {canUse && (
          <button type="submit" name="decision" value="allow" className={`${button} bg-accent text-white shadow-lg shadow-accent/30 hover:brightness-110`}>
            {t("Allow")}
          </button>
        )}
      </div>
    </form>,
  );
}
