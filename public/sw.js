// Page service worker: makes the dashboard installable and usable offline (last loaded view).
// Registered as /sw.js?v=<build id> (PwaRegister), so every build gets its own caches.
const VERSION = `page-v3-${new URL(self.location.href).searchParams.get("v") || "dev"}`;
const SHELL = `${VERSION}-shell`;
const STATIC = `${VERSION}-static`;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Live data is never cached.
  if (url.pathname.startsWith("/api/")) return;

  // Build assets are content-hashed: cache first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/pwa-icon/")) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // Pages: network first, fall back to the last copy of that page (or of "/").
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(req)) ?? (await caches.match("/")) ?? Response.error()),
    );
  }
});
