import { redirect } from "next/navigation";
import { loadConfig } from "@/lib/config/load";
import { clientAuth } from "@/lib/auth";
import { Background } from "@/components/Background";
import { FinancePage } from "@/components/finance/FinancePage";

export const dynamic = "force-dynamic";

export default async function Finance() {
  const auth = await clientAuth();
  if (!auth.user) redirect(auth.needsSetup ? "/setup" : "/login");
  if (!auth.user.permissions.includes("finance")) redirect("/");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { alerts, docker, auth: _a, ...settings } = loadConfig().settings;
  return (
    <>
      <Background settings={settings} />
      <FinancePage currency={settings.finance.currency} />
    </>
  );
}
