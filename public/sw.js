const CACHE_NAME = '2fauth-offline-v6';

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
      ]).then(() => {
        // Also try to cache critical assets that are currently available
        return Promise.allSettled([
          cache.add('/build/assets/app-SHmEvkuL.js').catch(() => {}),
          cache.add('/build/assets/app-BIlsKXRE.css').catch(() => {}),
          cache.add('/favicon.png').catch(() => {}),
          cache.add('/favicon.ico').catch(() => {}),
          cache.add('/favicon_lg.png').catch(() => {})
        ]);
      }).catch(error => {
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
  
  // Skip Chrome extension requests completely
  if (request.url.startsWith('chrome-extension://') || request.url.startsWith('moz-extension://')) {
    console.log('SW: Ignoring extension request:', url.href);
    return;
  }
  
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
              // Only cache HTTP/HTTPS requests, not chrome-extension:// requests
              if (request.url.startsWith('http')) {
                cache.put(request, responseToCache).catch(err => {
                  console.log('SW: Failed to cache:', request.url, err);
                });
              }
            });
          }
          return response;
        }).catch(error => {
          console.log('SW: Asset fetch failed, but continuing:', url.pathname, error);
          
          // For favicon and other non-critical assets, return a dummy response to prevent errors
          if (url.pathname.includes('/favicon') || url.pathname.includes('icon')) {
            console.log('SW: Returning dummy response for favicon');
            return new Response('', { 
              status: 404,
              statusText: 'Not Found',
              headers: { 'Content-Type': 'image/x-icon' }
            });
          }
          
          // For other assets, return a basic error response
          return new Response('Asset not available offline', {
            status: 404,
            statusText: 'Offline - Asset Not Available'
          });
        });
      })
    );
  }
  
  // For API calls and other requests, let them pass through normally
  else {
    console.log('SW: Passing through request:', url.pathname);
  }
});