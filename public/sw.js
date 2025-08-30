const CACHE_NAME = '2fauth-offline-v1';

// Install event - skip waiting to activate immediately
self.addEventListener('install', event => {
  self.skipWaiting();
});

// Activate event - take control immediately
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// Fetch event - simple network first, then show offline page
self.addEventListener('fetch', event => {
  // Only handle GET requests for HTML pages
  if (event.request.method === 'GET' && event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .catch(() => {
          // Network failed - return a basic offline fallback
          return new Response(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>2FAuth - Offline</title>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <style>
                body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                .offline { color: #666; }
              </style>
            </head>
            <body>
              <h1>2FAuth</h1>
              <div class="offline">
                <h2>You're offline</h2>
                <p>Please check your internet connection or try loading cached accounts.</p>
                <button onclick="window.location.reload()">Try Again</button>
              </div>
            </body>
            </html>
          `, {
            headers: { 'Content-Type': 'text/html' }
          });
        })
    );
  }
});