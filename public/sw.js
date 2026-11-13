// Service worker do ClimaCampingHoje: permite instalar como app e abre mais
// rápido. Regras:
//  - /api/* (clima): sempre da rede, nunca guardado aqui (o app já tem cache próprio);
//  - /assets/* (nomes com hash, nunca mudam): guarda e reaproveita;
//  - páginas: rede primeiro; sem internet, usa a última versão guardada;
//  - outros arquivos do site (ícones, manifesto): guardado, atualizado em segundo plano.
const CACHE = 'ccj-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// Só guarda respostas válidas. Um /assets/ inexistente volta como página HTML
// (fallback do site) e não pode ficar guardado no lugar do arquivo.
const cacheable = (req, res) =>
  res.ok && res.type === 'basic' && !(new URL(req.url).pathname.startsWith('/assets/') && (res.headers.get('content-type') || '').includes('text/html'))

async function put(req, res) {
  if (cacheable(req, res)) {
    const c = await caches.open(CACHE)
    await c.put(req, res.clone())
  }
  return res
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/__')) return

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => put(new Request('/'), res))
        .catch(() => caches.match('/').then((r) => r || Response.error())),
    )
    return
  }
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => put(req, res))))
    return
  }
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => put(req, res))
        .catch(() => hit)
      return hit || net
    }),
  )
})
