// Previsão dos próximos 5 dias para um ponto (município ou camping).
//
// Consulta direto do navegador (cada visitante usa a própria cota da Open-Meteo)
// e guarda por 1 h. Mesma metodologia do laudo do dia: os 6 modelos, mediana,
// faixa mín–máx e concordância. Se a Open-Meteo falhar, usa a MET Norway
// (fonte única, confiança menor).
import { MODELS, getJSON, valid, median, stats, cachedFetch, assessRisk, dayCondition as conditionOf } from './weather.js'

const API = 'https://api.open-meteo.com/v1/forecast'
const METNO = 'https://api.met.no/weatherapi/locationforecast/2.0/complete'
const TZ = 'America/Sao_Paulo'
const DAYS = 5
const CACHE_MS = 60 * 60 * 1000

export const PERIODS5 = [
  { key: 'madrugada', label: 'Madrugada', from: 0, to: 6, night: true },
  { key: 'manha', label: 'Manhã', from: 6, to: 12 },
  { key: 'tarde', label: 'Tarde', from: 12, to: 18 },
  { key: 'noite', label: 'Noite', from: 18, to: 24, night: true },
]

// Consolida N fontes. `src` = [{ label, days: { 'YYYY-MM-DD': { code, tMax, tMin, mm, prob, gust, storm, periods: [{mm, code, storm}] } } }]
function consolidate5(src, dates) {
  return dates.map((date) => {
    const per = src.map((s) => s.days[date]).filter((d) => d && (d.tMax != null || d.mm != null))
    const rain = stats(per.map((d) => d.mm))
    const storm = per.filter((d) => d.storm).length
    const day = {
      date,
      sources: per.length,
      tMax: stats(per.map((d) => d.tMax)),
      tMin: stats(per.map((d) => d.tMin)),
      rain,
      prob: stats(per.map((d) => d.prob)),
      gust: stats(per.map((d) => d.gust)),
      storm,
      condition: conditionOf(per.map((d) => d.code), rain?.median, storm, per.length),
      periods: PERIODS5.map((p, i) => {
        const pp = per.map((d) => d.periods?.[i]).filter((x) => x && (x.mm != null || x.code != null))
        const mm = stats(pp.map((x) => x.mm))
        const st = pp.filter((x) => x.storm).length
        return { ...p, sources: pp.length, mm, condition: pp.length ? conditionOf(pp.map((x) => x.code), mm?.median, st, pp.length) : null }
      }),
    }
    // Quantas fontes concordam em "vai chover" × "seco".
    const wet = (rain?.median ?? 0) >= 1
    day.agree = per.filter((d) => ((d.mm ?? 0) >= 1) === wet).length
    return { ...day, ...assessRisk({ storm, sources: day.sources, gust: day.gust?.median, rain: rain?.median, prob: day.prob?.median }) }
  })
}

// ---------- Open-Meteo (6 modelos) ----------
async function fromOpenMeteo(lat, lon) {
  const ids = MODELS.map((m) => m.id).join(',')
  const d = await getJSON(
    `${API}?latitude=${lat}&longitude=${lon}&timezone=${encodeURIComponent(TZ)}&forecast_days=${DAYS}&models=${ids}` +
      `&hourly=precipitation,weather_code` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max`,
    [1500, 4000],
  )
  const dates = d.daily.time
  const src = MODELS.map((m) => {
    const days = {}
    dates.forEach((date, di) => {
      const dv = (k) => d.daily[`${k}_${m.id}`]?.[di] ?? null
      const periods = PERIODS5.map((p) => {
        const idx = []
        d.hourly.time.forEach((t, i) => {
          const h = Number(t.slice(11, 13))
          if (t.startsWith(date) && h >= p.from && h < p.to) idx.push(i)
        })
        const mmv = valid(idx.map((i) => d.hourly[`precipitation_${m.id}`]?.[i]))
        const cv = valid(idx.map((i) => d.hourly[`weather_code_${m.id}`]?.[i]))
        return {
          mm: mmv.length ? mmv.reduce((a, b) => a + b, 0) : null,
          code: cv.length ? median(cv.map((c) => (c >= 51 ? 3 : c))) : null, // céu predominante; chuva vem do volume
          storm: cv.some((c) => c >= 95),
        }
      })
      days[date] = {
        code: dv('weather_code'),
        tMax: dv('temperature_2m_max'),
        tMin: dv('temperature_2m_min'),
        mm: dv('precipitation_sum'),
        prob: dv('precipitation_probability_max'),
        gust: dv('wind_gusts_10m_max'),
        storm: (dv('weather_code') ?? 0) >= 95,
        periods,
      }
    })
    return { label: m.label, days }
  })
  return { source: 'open-meteo', models: MODELS.map((m) => m.label), days: consolidate5(src, dates) }
}

// ---------- MET Norway (reserva) ----------
function metWmo(symbol) {
  if (!symbol) return null
  const s = symbol.replace(/_(day|night|polartwilight)$/, '')
  if (s.includes('thunder')) return 95
  return { clearsky: 0, fair: 1, partlycloudy: 2, cloudy: 3, fog: 45 }[s] ?? (s.startsWith('heavy') ? 65 : s.startsWith('light') ? 61 : 63)
}
const fmtLocal = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
function localParts(date) {
  const p = Object.fromEntries(fmtLocal.formatToParts(date).map((x) => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) }
}

async function fromMetno(lat, lon) {
  // Sem cabeçalhos extras: a MET libera CORS só para requisições simples.
  const r = await fetch(`${METNO}?lat=${(+lat).toFixed(4)}&lon=${(+lon).toFixed(4)}`)
  if (!r.ok) throw new Error(`MET Norway respondeu ${r.status}`)
  const d = await r.json()
  const days = {}
  const blank = () => ({ codes: [], tMax: [], tMin: [], mm: 0, mmN: 0, prob: [], gust: [], storm: false, periods: PERIODS5.map(() => ({ mm: 0, n: 0, codes: [], storm: false })) })
  for (const e of d.properties.timeseries) {
    // Primeiros ~2,5 dias vêm hora a hora; depois, em blocos de 6 h.
    const step = e.data.next_1_hours ? 1 : e.data.next_6_hours ? 6 : 0
    if (!step) continue
    const nx = step === 1 ? e.data.next_1_hours : e.data.next_6_hours
    const { date, hour } = localParts(new Date(e.time))
    const day = (days[date] ??= blank())
    const code = metWmo(nx.summary?.symbol_code)
    const mm = nx.details?.precipitation_amount ?? 0
    const inst = e.data.instant.details
    day.codes.push(code)
    day.tMax.push(nx.details?.air_temperature_max ?? inst.air_temperature)
    day.tMin.push(nx.details?.air_temperature_min ?? inst.air_temperature)
    day.mm += mm
    day.mmN += step
    if (nx.details?.probability_of_precipitation != null) day.prob.push(nx.details.probability_of_precipitation)
    if (inst.wind_speed_of_gust != null) day.gust.push(inst.wind_speed_of_gust * 3.6)
    if (code >= 95) day.storm = true
    const pi = PERIODS5.findIndex((p) => hour >= p.from && hour < p.to)
    const p = day.periods[pi]
    p.mm += mm
    p.n++
    p.codes.push(code)
    if (code >= 95) p.storm = true
  }
  const dates = Object.keys(days).sort().slice(0, DAYS)
  const out = {}
  for (const date of dates) {
    const x = days[date]
    out[date] = {
      code: Math.max(...valid(x.codes)),
      tMax: x.tMax.length ? Math.max(...valid(x.tMax)) : null,
      tMin: x.tMin.length ? Math.min(...valid(x.tMin)) : null,
      mm: Math.round(x.mm * 10) / 10,
      prob: x.prob.length ? Math.max(...x.prob) : null,
      gust: x.gust.length ? Math.max(...x.gust) : null,
      storm: x.storm,
      periods: x.periods.map((p) => (p.n ? { mm: Math.round(p.mm * 10) / 10, code: median(valid(p.codes).map((c) => (c >= 51 ? 3 : c))), storm: p.storm } : null)),
    }
  }
  return { source: 'met-norway', models: ['MET Norway'], days: consolidate5([{ label: 'MET Norway', days: out }], dates) }
}

export async function fetchForecast5(lat, lon) {
  const key = `ccj:5dias:v1:${(+lat).toFixed(3)},${(+lon).toFixed(3)}`
  const r = await cachedFetch(key, CACHE_MS, async () => {
    try {
      return await fromOpenMeteo(lat, lon)
    } catch (e) {
      const res = await fromMetno(lat, lon).catch(() => {
        throw e
      })
      return { ...res, aviso: `${e.message}. Mostrando a previsão da MET Norway (fonte única, confiança menor)` }
    }
  })
  return { ...r.data, at: r.at, stale: r.stale ? r.error?.message : null }
}
