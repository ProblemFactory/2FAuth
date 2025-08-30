const CACHE_NAME = '2fauth-offline-v2';
const urlsToCache = [
  '/',
  '/manifest.json',
  '/favicon.ico',
  '/logo.svg'
];

// Install event - cache essential files
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // Cache the main page and static assets
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - cleanup old caches
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

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', event => {
  const { request } = event;
  
  // For navigation requests (HTML pages)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          // If online, cache the response and return it
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, responseToCache);
          });
          return response;
        })
        .catch(() => {
          // If offline, try to serve from cache
          return caches.match('/').then(cachedResponse => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // Fallback for very first offline visit
            return new Response(`
              <!DOCTYPE html>
              <html>
              <head>
                <title>2FAuth - Offline</title>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <script>
                  // Redirect to main app after a short delay to let it load offline data
                  setTimeout(() => {
                    window.location.href = '/';
                  }, 2000);
                </script>
              </head>
              <body>
                <h1>2FAuth</h1>
                <p>Loading offline mode...</p>
              </body>
              </html>
            `, {
              headers: { 'Content-Type': 'text/html' }
            });
          });
        })
    );
  }
  
  // For other requests (CSS, JS, API), try network first, then cache
  else {
    event.respondWith(
      fetch(request)
        .then(response => {
          // Cache successful responses
          if (response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(request, responseToCache);
            });
          }
          return response;
        })
        .catch(() => {
          // Try to serve from cache
          return caches.match(request);
        })
    );
  }
});