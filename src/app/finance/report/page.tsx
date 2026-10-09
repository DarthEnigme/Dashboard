import { redirect } from "next/navigation";
import { loadConfig } from "@/lib/config/load";
import { clientAuth } from "@/lib/auth";
import { FinanceReport } from "@/components/finance/FinanceReport";

export const dynamic = "force-dynamic";

/** One-page summary of a month or year, laid out for printing ("Save as PDF"). */
export default async function Report({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const auth = await clientAuth();
  if (!auth.user) redirect(auth.needsSetup ? "/setup" : "/login");
  if (!auth.user.permissions.includes("finance")) redirect("/");
  const q = await searchParams;
  const { settings } = loadConfig();
  const period = /^\d{4}(-\d{2})?$/.test(q.period ?? "") ? q.period! : new Date().toISOString().slice(0, 7);
  const currency = /^[A-Z]{3}$/.test(q.currency ?? "") ? q.currency! : settings.finance.currency;
  return <FinanceReport title={settings.title} period={period} currency={currency} autoPrint={q.print === "1"} />;
}
