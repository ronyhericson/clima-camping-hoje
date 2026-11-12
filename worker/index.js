// Worker do ClimaCampingHoje (Cloudflare).
//
// - Serve o site (pasta dist/) como arquivos estáticos.
// - A cada 30 min (Cron Trigger) consulta a Open-Meteo UMA vez para todos os
//   visitantes e guarda o resultado consolidado no Workers KV:
//     · "tempo agora" a cada 30 min (28 chamadas);
//     · os 6 modelos a cada 3 h ou quando vira o dia (168 chamadas).
//   Total ≈ 2.700 chamadas/dia, fixo, não importa quantos visitantes.
// - Se a Open-Meteo falhar (ex.: limite diário), usa nesta ordem:
//     1. os 6 modelos já guardados de hoje (mesmo com mais de 3 h);
//     2. a fonte reserva MET Norway (worker/metno.js), uma fonte só.
// - GET /api/clima devolve o último resultado guardado. Se tudo falhar,
//   continua servindo a última consulta boa (com o horário dela).
import { CAMPINGS } from '../src/data/campings.js'
import { MODELS, fetchCurrentRaw, fetchModelsRaw, consolidateAll } from '../src/weather.js'
import { METNO_MODEL, fetchMetno } from './metno.js'

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
    const saved = await env.CLIMA.get(KEY_MODELOS, 'json')
    const fromToday = saved && saved.sig === SIG && saved.data?.[0]?.daily?.time?.[0] === todayInBrazil()
    let mod = fromToday && now - saved.at < MODELS_MAX_AGE ? saved : null
    let cur = null
    let models = MODELS
    let falha = null

    // 1. Open-Meteo: 6 modelos (a cada 3 h) + tempo agora (a cada 30 min).
    try {
      if (!mod) {
        mod = { at: now, sig: SIG, data: await fetchModelsRaw(CAMPINGS) }
        await env.CLIMA.put(KEY_MODELOS, JSON.stringify(mod))
      }
      cur = await fetchCurrentRaw(CAMPINGS)
    } catch (e) {
      falha = e
      console.log('Open-Meteo falhou:', e.message)
      // Modelos de hoje já guardados ainda servem, mesmo passando de 3 h.
      if (!mod && fromToday) mod = saved
    }

    // 2. Reserva: MET Norway para o que faltou.
    let reserva = null
    if (!cur || !mod) {
      try {
        const met = await fetchMetno(CAMPINGS, env.METNO_UA || 'ClimaCampingHoje/1.0')
        cur ??= met.cur
        if (!mod) {
          mod = { at: now, data: met.mod }
          models = [METNO_MODEL]
          reserva = 'previsao'
        } else reserva = 'agora'
      } catch (e) {
        console.log('MET Norway falhou:', e.message)
        throw new Error(`${falha?.message ?? 'Open-Meteo indisponível'}; fonte reserva (MET Norway) também falhou`)
      }
    }

    const data = consolidateAll(CAMPINGS, cur, mod.data, models)
    // Aviso mostrado no site quando parte dos dados veio da fonte reserva.
    const aviso =
      reserva === 'previsao'
        ? 'Open-Meteo indisponível: previsão de uma fonte só (MET Norway), confiança menor'
        : reserva === 'agora'
          ? 'Open-Meteo indisponível: tempo agora pela MET Norway; previsão dos 6 modelos das ' +
            new Date(mod.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
          : null
    if (aviso) data.forEach((r) => (r.aviso = aviso))
    const out = { at: now, modelsAt: mod.at, sig: SIG, fonte: reserva ? `met-norway:${reserva}` : 'open-meteo', aviso, data }
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
