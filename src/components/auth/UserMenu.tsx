"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { LogIn, LogOut, Settings, ShieldCheck, Wallet } from "lucide-react";
import { sendJson } from "@/lib/fetcher";
import type { ClientAuth } from "@/lib/auth";

/** Avatar with a small menu when signed in; a sign-in button otherwise. */
export function UserMenu({ auth }: { auth: ClientAuth }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  if (!auth.user) {
    const setup = auth.needsSetup;
    return (
      <a
        href={setup ? "/setup" : "/login"}
        className="glass glass-interactive flex h-11 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-medium"
        title={setup ? "Create the admin account" : "Sign in"}
      >
        <LogIn className="h-4 w-4" />
        <span className="hidden sm:inline">{setup ? "Set up" : "Sign in"}</span>
      </a>
    );
  }

  const u = auth.user;
  const label = u.name || u.username;
  const logout = async () => {
    await sendJson("/api/auth", "DELETE");
    window.location.href = auth.publicView ? "/" : "/login";
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${label}`}
        className="glass glass-interactive grid h-11 w-11 place-items-center rounded-full text-sm font-semibold"
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-accent to-accent/50 text-white">
          {label[0]?.toUpperCase()}
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="glass glass-lens absolute right-0 z-40 mt-2 w-56 rounded-2xl p-1.5"
            style={{ background: "var(--dialog)" }}
          >
            <div className="px-3 py-2">
              <div className="truncate text-sm font-semibold">{label}</div>
              <div className="flex items-center gap-1 text-xs text-muted">
                {u.role === "admin" && <ShieldCheck className="h-3.5 w-3.5" />}
                {u.role === "admin" ? "Admin" : "User"} · {u.username}
              </div>
            </div>
            <div className="my-1 h-px bg-track" />
            <a role="menuitem" href="/finance" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-hover">
              <Wallet className="h-4 w-4" /> Finance
            </a>
            {auth.canEdit && (
              <a role="menuitem" href="/settings" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-hover">
                <Settings className="h-4 w-4" /> Settings
              </a>
            )}
            <button role="menuitem" onClick={logout} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-hover">
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
