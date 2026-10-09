import { redirect } from "next/navigation";
import { loadConfig } from "@/lib/config/load";
import { clientAuth } from "@/lib/auth";
import { Background } from "@/components/Background";
import { InventoryPage } from "@/components/inventory/InventoryPage";

export const dynamic = "force-dynamic";

export default async function Inventory() {
  const auth = await clientAuth();
  if (!auth.user) redirect(auth.needsSetup ? "/setup" : "/login");
  if (!auth.user.permissions.includes("inventory")) redirect("/");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { alerts, docker, auth: _a, ...settings } = loadConfig().settings;
  return (
    <>
      <Background settings={settings} />
      <InventoryPage canWake={auth.user.permissions.includes("actions")} />
    </>
  );
}
