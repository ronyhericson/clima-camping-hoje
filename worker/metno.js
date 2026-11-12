// Fonte reserva: MET Norway (api.met.no, base do yr.no). Gratuita e sem chave.
// Só é usada pelo Worker quando a Open-Meteo falha (ex.: limite diário).
//
// Os dados são convertidos para o mesmo formato da Open-Meteo, para que a
// consolidação (laudo, períodos, comparativo) funcione sem mudanças. Como é
// uma fonte só, o laudo sai com confiança "baixa" e o site avisa.
//
// Termos de uso: https://api.met.no/doc/TermsOfService
// - User-Agent identificando o app (variável METNO_UA no wrangler.jsonc);
// - coordenadas com no máximo 4 casas decimais;
// - no máximo 20 requisições/s (aqui: 4 em paralelo, a cada 30 min).

const API = 'https://api.met.no/weatherapi/locationforecast/2.0/complete'
const TZ = 'America/Sao_Paulo'

export const METNO_MODEL = { id: 'metno', label: 'MET Norway', origem: 'yr.no · Noruega (fonte reserva)' }

// symbol_code do MET → código WMO (o mesmo usado pela Open-Meteo).
function wmo(symbol) {
  if (!symbol) return null
  const s = symbol.replace(/_(day|night|polartwilight)$/, '')
  if (s.includes('thunder')) return 95
  if (s === 'clearsky') return 0
  if (s === 'fair') return 1
  if (s === 'partlycloudy') return 2
  if (s === 'cloudy') return 3
  if (s === 'fog') return 45
  if (s.includes('snow')) return s.startsWith('heavy') ? 75 : s.startsWith('light') ? 71 : 73
  if (s.includes('sleet')) return s.startsWith('heavy') ? 67 : 66
  const shower = s.includes('showers')
  if (s.startsWith('heavy')) return shower ? 82 : 65
  if (s.startsWith('light')) return shower ? 80 : 61
  return shower ? 81 : 63
}

// Hora local no formato da Open-Meteo: "YYYY-MM-DDTHH:MM".
const fmtLocal = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
function localTime(date) {
  const p = Object.fromEntries(fmtLocal.formatToParts(date).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

const kmh = (ms) => (ms == null ? null : Math.round(ms * 3.6 * 10) / 10)

// Sensação térmica (mesma fórmula australiana usada pela Open-Meteo).
function apparent(t, rh, wsMs) {
  if (t == null || rh == null) return t ?? null
  const e = (rh / 100) * 6.105 * Math.exp((17.27 * t) / (237.7 + t))
  return Math.round((t + 0.33 * e - 0.7 * (wsMs ?? 0) - 4) * 10) / 10
}

const isDayOf = (symbol, hour) =>
  symbol?.endsWith('_night') ? 0 : symbol?.endsWith('_day') ? 1 : hour >= 6 && hour < 18 ? 1 : 0

async function fetchOne(c, ua) {
  const url = `${API}?lat=${(+c.lat).toFixed(4)}&lon=${(+c.lon).toFixed(4)}`
  const r = await fetch(url, { headers: { 'user-agent': ua, accept: 'application/json' } })
  if (!r.ok) throw new Error(`MET Norway respondeu ${r.status}`)
  return r.json()
}

// Converte uma resposta do MET em { cur, mod } no formato da Open-Meteo.
function convert(d, now = new Date()) {
  const ts = d.properties.timeseries
    .map((e) => ({ at: new Date(e.time), i: e.data.instant.details, n1: e.data.next_1_hours }))
    .filter((e) => e.n1) // só os passos horários (os primeiros ~2,5 dias)
  const hourStart = new Date(now)
  hourStart.setUTCMinutes(0, 0, 0)
  const first = ts.find((e) => e.at >= hourStart) ?? ts[0]
  const curHour = Number(localTime(first.at).slice(11, 13))

  const cur = {
    current: {
      time: localTime(now),
      temperature_2m: first.i.air_temperature ?? null,
      relative_humidity_2m: first.i.relative_humidity ?? null,
      apparent_temperature: apparent(first.i.air_temperature, first.i.relative_humidity, first.i.wind_speed),
      is_day: isDayOf(first.n1.summary?.symbol_code, curHour),
      precipitation: first.n1.details?.precipitation_amount ?? 0,
      weather_code: wmo(first.n1.summary?.symbol_code),
      cloud_cover: first.i.cloud_area_fraction ?? null,
      wind_speed_10m: kmh(first.i.wind_speed),
      wind_direction_10m: first.i.wind_from_direction ?? null,
      wind_gusts_10m: kmh(first.i.wind_speed_of_gust),
    },
  }
  // O "tempo agora" precisa casar com uma hora da série horária.
  cur.current.time = localTime(first.at)

  const id = METNO_MODEL.id
  const hourly = { time: [], [`precipitation_${id}`]: [], [`precipitation_probability_${id}`]: [], [`weather_code_${id}`]: [], [`wind_gusts_10m_${id}`]: [] }
  const temps = {}
  for (const e of ts) {
    if (e.at < hourStart) continue
    const t = localTime(e.at)
    hourly.time.push(t)
    hourly[`precipitation_${id}`].push(e.n1.details?.precipitation_amount ?? null)
    hourly[`precipitation_probability_${id}`].push(e.n1.details?.probability_of_precipitation ?? null)
    hourly[`weather_code_${id}`].push(wmo(e.n1.summary?.symbol_code))
    hourly[`wind_gusts_10m_${id}`].push(kmh(e.i.wind_speed_of_gust))
    ;(temps[t.slice(0, 10)] ??= []).push(e.i.air_temperature)
  }

  // Resumo diário a partir das horas que restam de cada dia.
  const days = [...new Set(hourly.time.map((t) => t.slice(0, 10)))].slice(0, 2)
  const daily = { time: days }
  const agg = (key, fn) =>
    days.map((day) => {
      const v = hourly.time.map((t, i) => (t.startsWith(day) ? hourly[`${key}_${id}`][i] : null)).filter((x) => x != null)
      return v.length ? fn(v) : null
    })
  daily[`precipitation_sum_${id}`] = agg('precipitation', (v) => Math.round(v.reduce((a, b) => a + b, 0) * 10) / 10)
  daily[`precipitation_probability_max_${id}`] = agg('precipitation_probability', (v) => Math.max(...v))
  daily[`wind_gusts_10m_max_${id}`] = agg('wind_gusts_10m', (v) => Math.max(...v))
  daily[`weather_code_${id}`] = agg('weather_code', (v) => Math.max(...v))
  daily[`temperature_2m_max_${id}`] = days.map((day) => (temps[day]?.length ? Math.max(...temps[day]) : null))
  daily[`temperature_2m_min_${id}`] = days.map((day) => (temps[day]?.length ? Math.min(...temps[day]) : null))

  return { cur, mod: { hourly, daily } }
}

// Consulta todos os campings (4 por vez) e devolve listas no formato da Open-Meteo.
export async function fetchMetno(campings, ua) {
  const out = new Array(campings.length)
  let next = 0
  const worker = async () => {
    while (next < campings.length) {
      const i = next++
      out[i] = convert(await fetchOne(campings[i], ua))
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  return { cur: out.map((o) => o.cur), mod: out.map((o) => o.mod) }
}
