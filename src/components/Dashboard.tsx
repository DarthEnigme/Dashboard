"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { AlertTriangle, WifiOff } from "lucide-react";
import type { ClientConfig } from "@/lib/config/sanitize";
import type { ClientAuth } from "@/lib/auth";
import { tabForPath, tabOf, type Tab } from "@/lib/tabs";
import { useOnline } from "@/lib/useOnline";
import { Header } from "./Header";
import { TabBar } from "./TabBar";
import { InfoBar } from "./InfoBar";
import { ServiceGroup } from "./ServiceGroup";
import { BookmarkGroup } from "./BookmarkGroup";
import { UserMenu } from "./auth/UserMenu";
import { LiveReload } from "./LiveReload";

// The editor (drag and drop, YAML parsing) is only downloaded when someone starts editing.
const Editor = dynamic(() => import("./edit/Editor").then((m) => m.Editor), { ssr: false });

const matches = (q: string, ...fields: (string | undefined)[]) => fields.some((f) => f?.toLowerCase().includes(q));

export function Dashboard({ config, auth, tabs, version }: { config: ClientConfig; auth: ClientAuth; tabs: Tab[]; version?: string }) {
  const { settings } = config;
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"view" | "edit">("view");
  const online = useOnline();
  const pathname = usePathname();
  const active = tabForPath(tabs, pathname)?.name ?? tabs[0]?.name ?? "";
  const q = query.trim().toLowerCase();
  const isAdmin = auth.user?.role === "admin";
  const { data: update } = useSWR<{ available: boolean; version?: string }>(isAdmin ? "/api/update?brief=1" : null, fetcher, {
    revalidateOnFocus: false,
  });

  // The command palette's "Edit dashboard": an event here, or /#edit from another page.
  useEffect(() => {
    if (!auth.canEdit) return;
    const edit = () => setMode("edit");
    if (window.location.hash === "#edit") {
      window.history.replaceState(null, "", window.location.pathname);
      edit();
    }
    window.addEventListener("page:edit", edit);
    return () => window.removeEventListener("page:edit", edit);
  }, [auth.canEdit]);

  // While filtering, search every tab; otherwise show the active tab only.
  const { services, bookmarks } = useMemo(() => {
    const inView = (groupTab?: string) => !!q || !tabs.length || tabOf(tabs, groupTab) === active;
    return {
      services: config.services
        .filter((g) => inView(g.tab))
        .map((g) => ({
          ...g,
          services: q ? g.services.filter((s) => matches(q, s.name, s.description, g.name)) : g.services,
        }))
        .filter((g) => g.services.length),
      bookmarks: config.bookmarks
        .filter((g) => inView(g.tab))
        .map((g) => ({ ...g, links: q ? g.links.filter((l) => matches(q, l.name, l.description, g.name)) : g.links }))
        .filter((g) => g.links.length),
    };
  }, [config.services, config.bookmarks, q, active, tabs]);

  const openFirst = () => {
    const href = services[0]?.services.find((s) => s.href)?.href ?? bookmarks[0]?.links[0]?.href;
    if (href) window.open(href, settings.target);
  };

  const selectTab = (t: Tab) => {
    // Next keeps usePathname in sync with pushState, so switching needs no server round trip.
    window.history.pushState(null, "", `/${t.slug}`);
    window.scrollTo({ top: 0 });
  };

  if (mode === "edit") {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-12">
        <Editor onExit={() => setMode("view")} />
      </main>
    );
  }

  const label = (groupTab?: string) => (q && tabs.length > 1 ? tabOf(tabs, groupTab) : undefined);

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6 lg:py-12">
      {settings.liveReload && <LiveReload version={version} />}
      <Header
        title={settings.title}
        description={settings.description}
        query={query}
        onQuery={setQuery}
        onSubmit={openFirst}
        onEdit={auth.canEdit ? () => setMode("edit") : undefined}
        showSettings={auth.canEdit}
        updateAvailable={update?.available ? update.version : undefined}
        account={<UserMenu auth={auth} />}
      />

      {!online && (
        <div className="glass flex w-fit items-center gap-2 rounded-full px-4 py-2 text-sm text-[var(--warn)]">
          <WifiOff className="h-4 w-4" /> Offline: showing the last loaded dashboard
        </div>
      )}

      {config.widgets.length > 0 && <InfoBar widgets={config.widgets} />}

      <TabBar tabs={tabs} active={q ? "" : active} onSelect={selectTab} />

      {config.errors.length > 0 && (
        <div className="glass flex gap-3 rounded-2xl p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--err)]" />
          <div className="space-y-1">
            <p className="font-medium">Config problems: the affected file is shown empty until fixed.</p>
            {config.errors.map((e) => (
              <p key={e} className="font-mono text-xs break-all text-muted">{e}</p>
            ))}
          </div>
        </div>
      )}

      {services.map((g, gi) => (
        <ServiceGroup key={`${g.tab}|${g.name}`} group={g} settings={settings} index={gi} forceOpen={!!q} tabLabel={label(g.tab)} canAct={auth.user?.role === "admin"} />
      ))}

      {bookmarks.length > 0 && (
        <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}>
          <h2 className="mb-3 px-1 text-sm font-semibold tracking-wider text-muted uppercase">Bookmarks</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] items-start gap-3.5">
            {bookmarks.map((g) => (
              <BookmarkGroup key={`${g.tab}|${g.name}`} group={g} target={settings.target} />
            ))}
          </div>
        </motion.section>
      )}

      {q && !services.length && !bookmarks.length && <p className="py-16 text-center text-muted">Nothing matches “{query}”.</p>}

    </main>
  );
}
