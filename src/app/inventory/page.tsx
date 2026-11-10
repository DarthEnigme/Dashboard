import { appShell } from "@/lib/appPage";
import { InventoryPage } from "@/components/inventory/InventoryPage";

export const dynamic = "force-dynamic";

export default async function Inventory() {
  const { user, background } = await appShell("inventory");
  return (
    <>
      {background}
      <InventoryPage canWake={user.permissions.includes("actions")} />
    </>
  );
}
