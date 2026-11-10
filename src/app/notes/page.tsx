import { appShell } from "@/lib/appPage";
import { NotesPage } from "@/components/notes/NotesPage";

export const dynamic = "force-dynamic";

/** ?note=<id> opens a note; ?service=<id> starts a new one linked to that service. */
export default async function Notes({ searchParams }: { searchParams: Promise<{ note?: string; service?: string }> }) {
  const { background } = await appShell("notes");
  const q = await searchParams;
  return (
    <>
      {background}
      <NotesPage openId={q.note ? Number(q.note) : undefined} forService={q.service} />
    </>
  );
}
