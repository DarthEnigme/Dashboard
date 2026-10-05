"use client";

import Link from "next/link";
import type { ClientService, ClientSettings } from "@/lib/config/sanitize";
import { Icon } from "./Icon";
import { StatusDot } from "./StatusDot";
import { WidgetFields } from "./WidgetFields";
import { History } from "./History";
import { ActionMenu } from "./ActionMenu";

const sizeClass = { small: "", wide: "tile-wide", tall: "tile-tall", large: "tile-large" } as const;

interface Props {
  service: ClientService;
  settings: ClientSettings;
  /** Admins get the actions menu (start/stop/restart). */
  canAct?: boolean;
}

/**
 * The title link is stretched over the whole card (so the card opens the service), while the
 * status and history link to the detail page and sit above it. No nested links.
 */
export function ServiceCard({ service: s, settings, canAct }: Props) {
  const size = s.size ?? "small";
  const big = size === "tall" || size === "large";
  const detail = `/service/${encodeURIComponent(s.id)}`;
  const external = settings.target === "_blank";

  return (
    <div
      className={`glass glass-interactive relative flex min-w-0 flex-col gap-3 rounded-2xl p-4 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-accent ${sizeClass[size]}`}
    >
      <div className="flex items-center gap-3">
        <Icon icon={s.icon} name={s.name} size={big ? 48 : 40} />
        <div className="min-w-0 flex-1">
          {s.href ? (
            <a
              href={s.href}
              target={settings.target}
              rel={external ? "noreferrer" : undefined}
              className="block truncate font-semibold leading-tight outline-none after:absolute after:inset-0 after:rounded-2xl"
            >
              {s.name}
            </a>
          ) : (
            <Link href={detail} className="block truncate font-semibold leading-tight outline-none after:absolute after:inset-0 after:rounded-2xl">
              {s.name}
            </Link>
          )}
          {s.description && <div className="truncate text-sm text-muted">{s.description}</div>}
        </div>
        {s.ping && (
          <Link href={detail} className="relative z-10 rounded-full" title="Status details">
            <StatusDot id={s.id} interval={settings.pingInterval} />
          </Link>
        )}
        {canAct && s.actions && <ActionMenu service={s} />}
      </div>
      {s.widget && (
        <WidgetFields id={s.id} interval={settings.refreshInterval} size={size} />
      )}
      {s.ping && (
        <Link href={detail} className="relative z-10 mt-auto block rounded-lg" aria-label={`${s.name}: uptime details`}>
          <History id={s.id} detailed={big} />
        </Link>
      )}
    </div>
  );
}
