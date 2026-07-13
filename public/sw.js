const CACHE_NAME = "contentflow-mobile-v2";
const APP_SHELL = [
  "/mobile.html",
  "/mobile.css?v=holographic-apple-1",
  "/mobile.js?v=holographic-apple-1",
  "/manifest.webmanifest",
  "/icon.svg",
  "/assets/brand/contentflow-holographic.webp"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/media/")) return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
