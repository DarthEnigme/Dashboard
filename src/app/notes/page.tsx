import { redirect } from "next/navigation";
import { loadConfig } from "@/lib/config/load";
import { clientAuth } from "@/lib/auth";
import { personal } from "@/lib/userLook";
import { Background } from "@/components/Background";
import { NotesPage } from "@/components/notes/NotesPage";

export const dynamic = "force-dynamic";

/** ?note=<id> opens a note; ?service=<id> starts a new one linked to that service. */
export default async function Notes({ searchParams }: { searchParams: Promise<{ note?: string; service?: string }> }) {
  const auth = await clientAuth();
  if (!auth.user) redirect(auth.needsSetup ? "/setup" : "/login");
  if (!auth.user.permissions.includes("notes")) redirect("/");
  const q = await searchParams;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { alerts, docker, auth: _a, ...settings } = loadConfig().settings;
  return (
    <>
      <Background settings={await personal(settings)} />
      <NotesPage openId={q.note ? Number(q.note) : undefined} forService={q.service} />
    </>
  );
}
