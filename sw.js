const CACHE = 'mcu-anumodana-v51';
const ASSETS = ['./', './index.html', './style.css', './app.js?v=51', './manifest.webmanifest', './assets/luxury_buddhist_background_v2.png', './assets/luxury_buddhist_background_campus_v4.png', './assets/ceremonial_offering_foreground_v4.png', './assets/campus_building_v44_style.png', './assets/ornate_thai_title_frame_v2.png', './assets/thai_portrait_frame_v1.png', './assets/mcu_logo.png', './assets/fonts/thsarabunnew-400.woff2', './assets/fonts/thsarabunnew-700.woff2', './assets/fonts/sarabun-400-thai.woff2', './assets/fonts/sarabun-400-latin.woff2', './assets/fonts/sarabun-500-thai.woff2', './assets/fonts/sarabun-500-latin.woff2', './assets/fonts/sarabun-600-thai.woff2', './assets/fonts/sarabun-600-latin.woff2', './assets/fonts/sarabun-700-thai.woff2', './assets/fonts/sarabun-700-latin.woff2'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match('./index.html'))));
});
