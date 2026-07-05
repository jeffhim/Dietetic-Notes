/* ═══════════════════════════════════════════════════════
   Jeffrey's Dietetics — Service Worker
   Enables full offline support by caching app shell +
   CDN resources. Uses network-first for HTML (always
   get latest when online) and cache-first for static
   assets (fonts, JS libraries, CSS).
   ═══════════════════════════════════════════════════════ */

var CACHE_VERSION = 'dietetics-v5.1-1';

/* Resources to pre-cache on install */
var PRECACHE_URLS = [
  './',
  './index.html',
  /* Firebase */
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js',
  /* Quill editor */
  'https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.js',
  'https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.snow.css',
  /* html2pdf */
  'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js',
  /* Font Awesome CSS */
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  /* Google Fonts CSS (the actual woff2 files are runtime-cached) */
  'https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800&display=swap'
];

/* ── Install: pre-cache core resources ───────────── */
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache) {
      /* Use addAll for same-origin + CORS-enabled CDNs.
         If any single resource fails, catch individually
         so the SW still installs. */
      var promises = PRECACHE_URLS.map(function(url) {
        return cache.add(url).catch(function(err) {
          console.log('[SW] Failed to pre-cache: ' + url + ' — ' + err.message);
        });
      });
      return Promise.all(promises);
    })
  );
  /* Activate immediately without waiting for old SW to die */
  self.skipWaiting();
});

/* ── Activate: clean old caches ──────────────────── */
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_VERSION; })
            .map(function(k) { return caches.delete(k); })
      );
    })
  );
  /* Take control of all open tabs immediately */
  self.clients.claim();
});

/* ── Fetch: serve from cache or network ──────────── */
self.addEventListener('fetch', function(event) {
  var request = event.request;

  /* Only handle GET requests */
  if (request.method !== 'GET') return;

  var url = new URL(request.url);

  /* ── Skip Firebase/Google API calls (Firestore, Auth, etc.) ── */
  if (url.hostname === 'firestore.googleapis.com' ||
      url.hostname === 'identitytoolkit.googleapis.com' ||
      url.hostname === 'securetoken.googleapis.com' ||
      url.hostname === 'www.googleapis.com' ||
      url.hostname === 'accounts.google.com' ||
      url.pathname.indexOf('/__/auth/') !== -1) {
    return;
  }

  /* ── Navigation requests (HTML pages): Network-first ── */
  if (request.mode === 'navigate' ||
      request.destination === 'document' ||
      url.pathname.endsWith('.html') ||
      url.pathname === '/' ||
      url.pathname === '') {
    event.respondWith(
      fetch(request).then(function(response) {
        /* Cache the latest version */
        if (response.ok) {
          var clone = response.clone();
          caches.open(CACHE_VERSION).then(function(cache) {
            cache.put(request, clone);
          });
        }
        return response;
      }).catch(function() {
        /* Offline → serve cached HTML */
        return caches.match(request).then(function(cached) {
          return cached || caches.match('./index.html');
        });
      })
    );
    return;
  }

  /* ── All other resources (JS, CSS, fonts, images): Cache-first ── */
  event.respondWith(
    caches.match(request).then(function(cached) {
      if (cached) return cached;

      return fetch(request).then(function(response) {
        /* Only cache successful responses from known CDNs */
        if (response.ok && url.protocol === 'https:') {
          var isCDN = (
            url.hostname === 'cdnjs.cloudflare.com' ||
            url.hostname === 'cdn.jsdelivr.net' ||
            url.hostname === 'www.gstatic.com' ||
            url.hostname === 'fonts.googleapis.com' ||
            url.hostname === 'fonts.gstatic.com' ||
            url.hostname === 'ka-f.fontawesome.com'
          );
          if (isCDN) {
            var clone = response.clone();
            caches.open(CACHE_VERSION).then(function(cache) {
              cache.put(request, clone);
            });
          }
        }
        return response;
      }).catch(function() {
        /* If font request fails offline, return empty response
           so the page doesn't hang waiting for fonts */
        if (request.destination === 'font') {
          return new Response('', { status: 200, statusText: 'OK' });
        }
        return new Response('Offline — resource not cached', {
          status: 503,
          statusText: 'Service Unavailable'
        });
      });
    })
  );
});
