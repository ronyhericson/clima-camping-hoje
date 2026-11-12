// Worker do ClimaCampingHoje (Cloudflare).
//
// - Serve o site (pasta dist/) como arquivos estáticos.
// - A cada 30 min (Cron Trigger) consulta a Open-Meteo UMA vez para todos os
//   visitantes e guarda o resultado consolidado no Workers KV:
//     · "tempo agora" a cada 30 min (28 chamadas);
//     · os 6 modelos a cada 3 h ou quando vira o dia (168 chamadas).
//   Total ≈ 2.700 chamadas/dia, fixo, não importa quantos visitantes.
// - GET /api/clima devolve o último resultado guardado. Se a Open-Meteo
//   falhar, continua servindo a última consulta boa (com o horário dela).
import { CAMPINGS } from '../src/data/campings.js'
import { fetchCurrentRaw, fetchModelsRaw, consolidateAll } from '../src/weather.js'

const TZ = 'America/Sao_Paulo'
const KEY_CLIMA = 'clima:v1'
const KEY_MODELOS = 'modelos:v1'
const KEY_TRAVA = 'atualizando'
const MODELS_MAX_AGE = 3 * 60 * 60 * 1000
const STALE_AFTER = 45 * 60 * 1000 // passou disso, o cron provavelmente falhou

// Muda quando a lista de campings ou as coordenadas mudam: força nova consulta.
const SIG = [...CAMPINGS.map((c) => `${c.id}@${c.lat},${c.lon}`).join('|')]
  .reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7)
  .toString(36)

const todayInBrazil = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())

async function update(env) {
  // Trava simples para duas atualizações não rodarem juntas (expira sozinha).
  if (await env.CLIMA.get(KEY_TRAVA)) return null
  await env.CLIMA.put(KEY_TRAVA, '1', { expirationTtl: 120 })
  try {
    const now = Date.now()
    let mod = await env.CLIMA.get(KEY_MODELOS, 'json')
    const modelsOk =
      mod && mod.sig === SIG && now - mod.at < MODELS_MAX_AGE && mod.data?.[0]?.daily?.time?.[0] === todayInBrazil()
    if (!modelsOk) {
      mod = { at: now, sig: SIG, data: await fetchModelsRaw(CAMPINGS) }
      await env.CLIMA.put(KEY_MODELOS, JSON.stringify(mod))
    }
    const cur = await fetchCurrentRaw(CAMPINGS)
    const out = { at: now, modelsAt: mod.at, sig: SIG, data: consolidateAll(CAMPINGS, cur, mod.data) }
    await env.CLIMA.put(KEY_CLIMA, JSON.stringify(out))
    return out
  } finally {
    await env.CLIMA.delete(KEY_TRAVA)
  }
}

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=120', ...extra },
  })

async function apiClima(env, ctx) {
  let saved = await env.CLIMA.get(KEY_CLIMA, 'json')
  if (!saved || saved.sig !== SIG) {
    // Primeira vez (ou lista de campings mudou): consulta agora.
    try {
      saved = (await update(env)) ?? saved
    } catch (e) {
      if (!saved) return json({ error: e.message }, 503, { 'cache-control': 'no-store' })
    }
    if (!saved) return json({ error: 'atualizando' }, 503, { 'cache-control': 'no-store' })
  } else if (Date.now() - saved.at > STALE_AFTER) {
    // Dado velho (cron falhou?): devolve o que tem e tenta atualizar em segundo plano.
    ctx.waitUntil(update(env).catch(() => {}))
  }
  return json(saved)
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (url.pathname === '/api/clima') return apiClima(env, ctx)
    return env.ASSETS.fetch(request)
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(update(env))
  },
}
