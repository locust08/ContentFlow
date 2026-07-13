const CACHE_NAME = "contentflow-mobile-v3";
const APP_SHELL = [
  "/mobile.html",
  "/mobile.css?v=studio-bee-1",
  "/mobile.js?v=studio-bee-1",
  "/manifest.webmanifest",
  "/favicon-32.png",
  "/assets/brand/contentflow-bee.png",
  "/assets/brand/contentflow-bee-192.png",
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
