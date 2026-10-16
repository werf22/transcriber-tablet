// sw.js — service worker: offline app shell + Android share target.
// CACHE: network-first for our own files (updates arrive on the next open),
//        falling back to the cache when offline. ElevenLabs API calls are
//        never touched (cross-origin → passed straight through).
// TWEAK: bump CACHE when renaming files; SHELL must list every app file —
//        tests/pwa.test.mjs fails if a file in web/ is missing from it.
import { stash } from "./js/share-db.js";

const CACHE = "transcriber-v1";
const NETWORK_TIMEOUT_MS = 3000; // knob: how long to wait for the net before using the cache
const SHELL = [
  "./", "index.html", "manifest.webmanifest", "css/app.css",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png",
  "js/app.js", "js/api.js", "js/constants.js", "js/docx.js", "js/export.js", "js/format.js",
  "js/formdata.js", "js/log.js", "js/pdf.js", "js/queue.js", "js/share.js", "js/share-db.js",
  "js/store.js", "js/wakelock.js", "js/zip.js",
  "js/ui/dom.js", "js/ui/export-view.js", "js/ui/preview-view.js", "js/ui/queue-view.js", "js/ui/settings-view.js",
  "vendor/pdfmake/pdfmake.min.js", "vendor/pdfmake/vfs_fonts.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function shareTarget(request) {
  try {
    const form = await request.formData();
    const files = form.getAll("media").filter((f) => f instanceof File);
    await stash(files);
  } catch (err) {
    console.error("share target failed", err); // page shows "0 files received"
  }
  return Response.redirect("./?shared=1", 303);
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), NETWORK_TIMEOUT_MS)),
    ]);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    if (request.mode === "navigate") return (await cache.match("index.html")) || Response.error();
    return Response.error();
  }
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // API traffic: hands off
  if (e.request.method === "POST" && url.pathname.endsWith("/share-target")) {
    e.respondWith(shareTarget(e.request));
    return;
  }
  if (e.request.method === "GET") e.respondWith(networkFirst(e.request));
});
