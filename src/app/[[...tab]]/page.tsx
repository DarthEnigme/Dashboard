import { notFound, redirect } from "next/navigation";
import { getConfig } from "@/lib/config";
import { sanitize } from "@/lib/config/sanitize";
import { configVersion } from "@/lib/config/watch";
import { clientAuth, seeFilter } from "@/lib/auth";
import { listTabs, tabForPath } from "@/lib/tabs";
import { Background } from "@/components/Background";
import { Dashboard } from "@/components/Dashboard";

export const dynamic = "force-dynamic";

export default async function Home({ params }: { params: Promise<{ tab?: string[] }> }) {
  const { tab = [] } = await params;
  const auth = await clientAuth();
  if (!auth.user && !auth.publicView) redirect(auth.needsSetup ? "/setup" : "/login");

  const version = configVersion(); // before reading, so a change made meanwhile still counts as newer
  const config = sanitize(await getConfig(), await seeFilter());
  const tabs = listTabs(config.settings.tabs, [...config.services, ...config.bookmarks]);
  if (tab.length > 1 || !tabForPath(tabs, tab.join("/"))) notFound();
  return (
    <>
      <Background settings={config.settings} />
      <Dashboard config={config} auth={auth} tabs={tabs} version={version} />
    </>
  );
}
