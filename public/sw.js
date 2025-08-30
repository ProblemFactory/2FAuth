const CACHE_NAME = '2fauth-offline-v3';

// Install event - just activate immediately 
self.addEventListener('install', event => {
  self.skipWaiting();
});

// Activate event - take control immediately
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(cacheName => cacheName !== CACHE_NAME)
          .map(cacheName => caches.delete(cacheName))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - minimal intervention
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Only cache when online, don't interfere with navigation when offline
  if (request.method === 'GET' && request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          // If online, cache the main page for future offline use
          if (url.pathname === '/') {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put('/', responseToCache);
            });
          }
          return response;
        })
        .catch(() => {
          // If offline, serve cached main page if available
          if (url.pathname === '/') {
            return caches.match('/').then(cachedResponse => {
              if (cachedResponse) {
                return cachedResponse;
              }
              // Let the app handle offline mode internally
              return fetch(request);
            });
          }
          // For other navigation, let it fail naturally
          return fetch(request);
        })
    );
  }
  
  // For static assets, try cache first
  else if (request.method === 'GET' && (
    url.pathname.includes('/build/') || 
    url.pathname.includes('.css') || 
    url.pathname.includes('.js') ||
    url.pathname.includes('/favicon') ||
    url.pathname.includes('/manifest.json')
  )) {
    event.respondWith(
      caches.match(request).then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then(response => {
          if (response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(request, responseToCache);
            });
          }
          return response;
        });
      })
    );
  }
  
  // For everything else (API calls etc), don't interfere
});