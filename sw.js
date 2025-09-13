const CACHE_NAME = 'arsenal-bet-cache-v1';
const FILES_TO_CACHE = ['./','./index.html','./manifest.json','./icon-192.png','./icon-512.png'];
self.addEventListener('install', event => { 
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(FILES_TO_CACHE))); 
  self.skipWaiting(); 
});
self.addEventListener('activate', event => { 
  event.waitUntil(self.clients.claim()); 
});
self.addEventListener('fetch', event => { 
  event.respondWith(caches.match(event.request).then(resp => resp || fetch(event.request))); 
});