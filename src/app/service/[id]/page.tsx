import { notFound, redirect } from "next/navigation";
import { getConfig } from "@/lib/config";
import { sanitize } from "@/lib/config/sanitize";
import { clientAuth, seeFilter } from "@/lib/auth";
import { Background } from "@/components/Background";
import { ServiceDetail } from "@/components/ServiceDetail";

export const dynamic = "force-dynamic";

export default async function ServicePage({ params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id);
  const auth = await clientAuth();
  if (!auth.user && !auth.publicView) redirect("/login");
  const config = sanitize(await getConfig(), await seeFilter());
  const group = config.services.find((g) => g.services.some((s) => s.id === id));
  const service = group?.services.find((s) => s.id === id);
  if (!group || !service) notFound();
  return (
    <>
      <Background settings={config.settings} />
      <ServiceDetail service={service} group={group.name} settings={config.settings} canAct={!!auth.user?.permissions.includes("actions")} />
    </>
  );
}
