"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useT } from "@/i18n/client";

interface Props {
  title: string;
  subtitle?: ReactNode;
  /** Where the link above the title leads (the dashboard, unless the page sits inside an app). */
  back?: { href: string; label: string };
  /** The page's main buttons, on the right. */
  children?: ReactNode;
}

/** The top of an app's page: the way back, its name and a line about it. */
export function AppHeader({ title, subtitle, back = { href: "/", label: "Dashboard" }, children }: Props) {
  const t = useT();
  return (
    <>
      <Link href={back.href} className="flex w-fit items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> {t(back.label)}
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="text-muted">{subtitle}</p>}
        </div>
        {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
      </header>
    </>
  );
}
