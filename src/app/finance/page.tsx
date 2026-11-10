import { appShell } from "@/lib/appPage";
import { FinancePage } from "@/components/finance/FinancePage";

export const dynamic = "force-dynamic";

export default async function Finance() {
  const { settings, background } = await appShell("finance");
  return (
    <>
      {background}
      <FinancePage currency={settings.finance.currency} />
    </>
  );
}
