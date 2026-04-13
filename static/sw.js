// Item Tracker — Service Worker
// Strategy:
//   - Static assets (/static/*)   → stale-while-revalidate (instant load, refresh in background)
//   - Page navigation              → network-first with cache fallback (always try fresh HTML)
//   - API calls (/api/*)           → network-only (never serve stale data)
//   - POST / non-GET               → pass through, no caching

const CACHE = "itemtracker-v1";

// ── Install ────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  // Activate immediately — don't wait for old tabs to close
  self.skipWaiting();
});

// ── Activate ───────────────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// ── Fetch ──────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // Never intercept non-GET requests (uploads, logins, etc.)
  if (request.method !== "GET") return;

  // Never cache API responses — always need live data
  if (url.pathname.startsWith("/api/")) return;

  // Static assets — stale-while-revalidate
  if (url.pathname.startsWith("/static/")) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Page navigations — network-first with offline fallback
  event.respondWith(networkFirstWithCache(request));
});

// ── Strategies ─────────────────────────────────────────────────────────────

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);

  // Kick off a background network fetch to keep the cache fresh
  const networkFetch = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  // Return cached immediately if we have it, otherwise wait for network
  return cached || networkFetch;
}

async function networkFirstWithCache(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || new Response("You are offline and this page has not been cached yet.", {
      status: 503,
      headers: { "Content-Type": "text/plain" }
    });
  }
}
