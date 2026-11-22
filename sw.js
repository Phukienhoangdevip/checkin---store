/* Service worker – app Quản lý Thị trường & Sales Hoàng Đế (từ Bản 70)
   - Lưu sẵn trang app + thư viện để mở được khi không có mạng.
   - Trang app: ưu tiên tải bản mới từ mạng (chờ tối đa 6 giây), mất mạng thì mở bản đã lưu.
   - Thư viện CDN (đã ghim phiên bản): lấy từ bộ nhớ đệm trước.
   - KHÔNG lưu dữ liệu đồng bộ (Google Apps Script) và ảnh bản đồ nền. */
const SW_VER = 'hd-sw-70';
const PAGE_CACHE = 'hd-page-v1';
const LIB_CACHE = 'hd-lib-' + SW_VER;
const LIBS = [
  'https://cdn.tailwindcss.com/3.4.17',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-regular-400.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-brands-400.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/layers.png',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
];
const LIB_HOSTS = ['cdn.tailwindcss.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net'];
const PAGE_URL = () => new URL('./', self.registration.scope).href;

async function fetchLib(url) {
  try { const r = await fetch(url, { mode: 'cors', credentials: 'omit' }); if (r.ok) return r; } catch (e) {}
  return fetch(url, { mode: 'no-cors', credentials: 'omit' });
}

self.addEventListener('install', ev => {
  ev.waitUntil((async () => {
    const c = await caches.open(LIB_CACHE);
    await Promise.allSettled(LIBS.map(async u => { if (!(await c.match(u))) { const r = await fetchLib(u); if (r && (r.ok || r.type === 'opaque')) await c.put(u, r); } }));
    try { const p = await fetch(PAGE_URL(), { cache: 'no-store' }); if (p.ok) await (await caches.open(PAGE_CACHE)).put(PAGE_URL(), p); } catch (e) {}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', ev => {
  ev.waitUntil((async () => {
    const keep = new Set([PAGE_CACHE, LIB_CACHE]);
    for (const k of await caches.keys()) if (k.startsWith('hd-') && !keep.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

const verOf = t => { const m = /APP_VER\s*=\s*(\d+)/.exec(t || ''); return m ? Number(m[1]) : 0; };
async function notifyNewVersion(resp) {
  try {
    const v = verOf(await resp.clone().text()); if (!v) return;
    for (const cl of await self.clients.matchAll({ type: 'window' })) cl.postMessage({ type: 'hd-new-version', ver: v });
  } catch (e) {}
}

async function pageResponse(req) {
  const cache = await caches.open(PAGE_CACHE), key = PAGE_URL();
  const net = fetch(req, { cache: 'no-store' }).then(async r => {
    if (r && r.ok) { await cache.put(key, r.clone()); }
    return r;
  });
  const timeout = new Promise(res => setTimeout(() => res(null), 6000));
  try {
    const r = await Promise.race([net, timeout]);
    if (r && r.ok) return r;
  } catch (e) {}
  const cached = await cache.match(key);
  if (cached) {
    // Mạng chậm: mở bản đã lưu ngay, khi bản mới tải xong thì báo app để cập nhật
    net.then(r => { if (r && r.ok) notifyNewVersion(r); }).catch(() => {});
    return cached;
  }
  return net;   // chưa từng lưu: đành chờ mạng
}

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('script.google.com') || url.hostname.endsWith('googleusercontent.com')) return;   // dữ liệu đồng bộ: luôn đi mạng
  if (req.mode === 'navigate' && url.origin === self.location.origin) { ev.respondWith(pageResponse(req)); return; }
  if (LIB_HOSTS.includes(url.hostname)) {
    ev.respondWith((async () => {
      const c = await caches.open(LIB_CACHE), hit = await c.match(req.url);
      if (hit) return hit;
      const r = await fetch(req);
      if (r && (r.ok || r.type === 'opaque')) c.put(req.url, r.clone()).catch(() => {});
      return r;
    })());
  }
  // còn lại (bản đồ nền, tra địa chỉ, chỉ đường...): đi mạng bình thường
});
