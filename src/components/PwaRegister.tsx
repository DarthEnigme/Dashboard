"use client";

import { useEffect } from "react";

/** Service workers need a secure context (HTTPS or localhost); elsewhere this is a no-op. */
export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    if (process.env.NODE_ENV !== "production") return; // avoid caching dev builds
    // A new build registers a new worker URL, which replaces the old worker and its caches.
    const build = document.documentElement.dataset.build ?? "";
    navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(build)}`).catch(() => {});
  }, []);
  return null;
}
