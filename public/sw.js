const CACHE_NAME = '2fauth-offline-v4';

// Install event - pre-cache essential resources
self.addEventListener('install', event => {
  console.log('SW: Installing');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('SW: Opened cache');
      // Pre-cache the main page and essential assets
      return cache.addAll([
        '/',
        '/manifest.json'
      ]).catch(error => {
        console.log('SW: Pre-cache failed:', error);
      });
    }).then(() => {
      console.log('SW: Skip waiting');
      self.skipWaiting();
    })
  );
});

// Activate event - clean up old caches and take control
self.addEventListener('activate', event => {
  console.log('SW: Activating');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(cacheName => cacheName !== CACHE_NAME)
          .map(cacheName => {
            console.log('SW: Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          })
      );
    }).then(() => {
      console.log('SW: Claiming clients');
      return self.clients.claim();
    })
  );
});

// Fetch event - cache-first for main page and assets
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  
  console.log('SW: Handling fetch for:', url.pathname);
  
  // Handle navigation requests (main page)
  if (request.method === 'GET' && request.mode === 'navigate') {
    console.log('SW: Navigation request for:', url.pathname);
    event.respondWith(
      caches.match('/').then(cachedResponse => {
        if (cachedResponse) {
          console.log('SW: Serving cached main page');
          // Always try to update cache in background
          fetch(request).then(response => {
            if (response && response.status === 200) {
              caches.open(CACHE_NAME).then(cache => {
                console.log('SW: Updating cached main page');
                cache.put('/', response.clone());
              });
            }
          }).catch(() => {
            console.log('SW: Background fetch failed, but cached version available');
          });
          return cachedResponse;
        }
        
        // No cache available, try network
        console.log('SW: No cached main page, trying network');
        return fetch(request).then(response => {
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              console.log('SW: Caching main page for first time');
              cache.put('/', responseToCache);
            });
          }
          return response;
        }).catch(error => {
          console.log('SW: Network failed and no cache available:', error);
          return new Response(
            '<!DOCTYPE html><html><head><title>Offline</title></head><body><h1>You are offline</h1><p>Please check your connection and try again.</p></body></html>',
            { headers: { 'Content-Type': 'text/html' } }
          );
        });
      })
    );
  }
  
  // Handle static assets - cache first
  else if (request.method === 'GET' && (
    url.pathname.includes('/build/') || 
    url.pathname.includes('.css') || 
    url.pathname.includes('.js') ||
    url.pathname.includes('/favicon') ||
    url.pathname.includes('/manifest.json') ||
    url.pathname.includes('/storage/') // User uploaded icons
  )) {
    console.log('SW: Asset request for:', url.pathname);
    event.respondWith(
      caches.match(request).then(cachedResponse => {
        if (cachedResponse) {
          console.log('SW: Serving cached asset:', url.pathname);
          return cachedResponse;
        }
        
        console.log('SW: Fetching and caching asset:', url.pathname);
        return fetch(request).then(response => {
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(request, responseToCache);
            });
          }
          return response;
        }).catch(error => {
          console.log('SW: Asset fetch failed:', url.pathname, error);
          throw error;
        });
      })
    );
  }
  
  // For API calls and other requests, let them pass through normally
  else {
    console.log('SW: Passing through request:', url.pathname);
  }
});