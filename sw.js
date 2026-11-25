const C = 'kp-v12',
  CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
  FC = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap',
  ASSETS = ['./', 'index.html', 'style.css', 'app.js', 'manifest.json'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil((async () => {
    const c = await caches.open(C);
    await Promise.all(ASSETS.map(async u => {
      try {
        const r = await fetch(u, { cache: 'reload' });
        if (r.ok) await c.put(u, r);
      } catch {}
    }));
    try { await c.put(CDN, await fetch(CDN, { mode: 'no-cors' })); } catch {}
    try {
      const r = await fetch(FC);
      await c.put(FC, r.clone());
      for (const m of (await r.text()).matchAll(/url\((https:[^)]+)\)/g)) {
        await c.put(m[1], await fetch(m[1]));
      }
    } catch {}
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const isLocal = url.origin === self.location.origin;

  if (isLocal) {
    e.respondWith(
      fetch(e.request, { cache: 'no-cache' })
        .then(r => {
          if (r && r.ok) {
            const k = r.clone();
            caches.open(C).then(c => c.put(e.request, k));
          }
          return r;
        })
        .catch(() =>
          caches.match(e.request, { ignoreSearch: true })
            .then(h => h || (e.request.mode === 'navigate' ? caches.match('index.html') : undefined))
        )
    );
  } else {
    e.respondWith(
      caches.match(e.request).then(h => h || fetch(e.request).then(r => {
        if (r.ok || r.type === 'opaque') {
          const k = r.clone();
          caches.open(C).then(c => c.put(e.request, k));
        }
        return r;
      }))
    );
  }
});
