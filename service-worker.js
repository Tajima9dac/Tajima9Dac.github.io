/* Manifest version: yzS/PJCF */
self.importScripts('/service-worker-assets.js');

const cacheNamePrefix = 'offline-cache-';
const cacheName = `${cacheNamePrefix}${self.assetsManifest.version}`;

const offlineAssetsInclude = [
    /\.dll$/, /\.pdb$/, /\.wasm$/, /\.html$/, /\.js$/, /\.json$/,
    /\.css$/, /\.woff2?$/, /\.png$/, /\.jpe?g$/, /\.gif$/, /\.ico$/,
    /\.blat$/, /\.dat$/, /\.webmanifest$/, /\.br$/, /\.gz$/,
    /material-icons/, /fonts/
];

const offlineAssetsExclude = [/^service-worker\.js$/];

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(cacheName);

        const requests = self.assetsManifest.assets
            .filter(a => offlineAssetsInclude.some(r => r.test(a.url)))
            .filter(a => !offlineAssetsExclude.some(r => r.test(a.url)))
            .map(a => new Request(a.url, {
                integrity: a.hash,
                cache: 'no-cache'
            }));

        await cache.addAll(requests);
        await cache.add('/index.html');

        self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(
            keys.filter(k => k.startsWith(cacheNamePrefix) && k !== cacheName)
                .map(k => caches.delete(k))
        );

        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    event.respondWith((async () => {
        const cache = await caches.open(cacheName);
        const acceptEncoding = event.request.headers.get('Accept-Encoding') || '';
        const url = new URL(event.request.url);
        let tryCompressed = false;
        let compressedExt = '';

        // Only try for same-origin requests
        if (url.origin === self.location.origin) {
            if (acceptEncoding.includes('br')) {
                tryCompressed = true;
                compressedExt = '.br';
            } else if (acceptEncoding.includes('gzip') || acceptEncoding.includes('gz')) {
                tryCompressed = true;
                compressedExt = '.gz';
            }
        }

        // Try to serve compressed file if available
        if (tryCompressed) {
            let compressedUrl = url.pathname + compressedExt + url.search;
            let compressedReq = new Request(compressedUrl, { method: 'GET' });
            let cachedCompressed = await cache.match(compressedReq, { ignoreSearch: true });
            if (cachedCompressed) {
                // Set correct Content-Encoding header
                let headers = new Headers(cachedCompressed.headers);
                headers.set('Content-Encoding', compressedExt === '.br' ? 'br' : 'gzip');
                return new Response(await cachedCompressed.arrayBuffer(), {
                    status: cachedCompressed.status,
                    statusText: cachedCompressed.statusText,
                    headers: headers
                });
            }
        }

        // Fallback to normal cache
        const cached = await cache.match(event.request, { ignoreSearch: true });
        if (cached) return cached;

        if (event.request.mode === 'navigate') {
            const index = await cache.match('/index.html');
            if (index) return index;
        }

        try {
            return await fetch(event.request);
        } catch {
            return new Response('', { status: 503 });
        }
    })());
});
