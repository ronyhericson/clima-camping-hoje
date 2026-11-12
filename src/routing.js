// Rotas pelas ruas (OSRM / OpenStreetMap), busca de endereços (Photon / OpenStreetMap)
// e previsão do tempo nos pontos do trajeto, no horário estimado de passagem.
import { MODELS, categorize, getJSON, valid, median, stats } from './weather.js'

const OSRM = 'https://router.project-osrm.org/route/v1/driving'
const PHOTON = 'https://photon.komoot.io'
const API = 'https://api.open-meteo.com/v1/forecast'
const TZ = 'America/Sao_Paulo'

// ---------- geocodificação ----------
function photonLabel(p) {
  const main = [p.name, p.housenumber && p.street ? `${p.street}, ${p.housenumber}` : p.street].filter(Boolean)[0]
  const place = [p.city || p.town || p.village || p.county, p.state].filter(Boolean).join(' · ')
  return { title: main || place || 'Local', subtitle: main ? place : p.country || '' }
}

// Endereços, ruas e lugares no Brasil (com prioridade para perto de São Paulo).
export async function searchAddress(q, signal) {
  const url =
    `${PHOTON}/api/?q=${encodeURIComponent(q)}&limit=10&bbox=-53.2,-25.4,-44.1,-19.7` +
    `&lat=-23.55&lon=-46.63&zoom=7&location_bias_scale=0.1`
  const r = await fetch(url, { signal })
  if (!r.ok) return []
  const d = await r.json()
  // Uma mesma rua costuma vir em vários trechos: mantém um por nome + cidade.
  const seen = new Set()
  return d.features
    .map((f) => ({ ...photonLabel(f.properties), coord: f.geometry.coordinates, kind: 'endereco' }))
    .filter((o) => {
      const key = `${o.title}|${o.subtitle}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 6)
}

export async function reverseLabel([lon, lat]) {
  try {
    const r = await fetch(`${PHOTON}/reverse?lon=${lon}&lat=${lat}`)
    const d = await r.json()
    const p = d.features?.[0]?.properties
    return p ? [p.street || p.name, p.city || p.town || p.village].filter(Boolean).join(', ') : null
  } catch {
    return null
  }
}

export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocalização indisponível neste navegador'))
    navigator.geolocation.getCurrentPosition(
      (p) => resolve([p.coords.longitude, p.coords.latitude]),
      (e) => reject(new Error(e.code === 1 ? 'Permissão de localização negada' : 'Não foi possível obter sua localização')),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 },
    )
  })
}

// ---------- rota ----------
export async function fetchRoute(from, to) {
  const url = `${OSRM}/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson&alternatives=false&steps=false`
  const d = await getJSON(url, [1500, 4000])
  if (d.code !== 'Ok' || !d.routes?.length) throw new Error('Nenhuma rota encontrada entre esses pontos')
  const r = d.routes[0]
  return { coords: r.geometry.coordinates, distance: r.distance, duration: r.duration }
}

const toRad = (d) => (d * Math.PI) / 180
function haversine([lon1, lat1], [lon2, lat2]) {
  const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(a))
}

// Pontos de clima distribuídos ao longo do trajeto (início, intermediários e chegada).
export function checkpoints(route, departure) {
  const { coords, duration } = route
  const cum = [0]
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]))
  const total = cum[cum.length - 1] || 1
  const km = total / 1000
  const n = Math.max(3, Math.min(12, Math.round(km / 25) + 2))
  const pts = []
  let j = 0
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1)
    while (j < cum.length - 1 && cum[j] < target) j++
    const frac = cum[j] / total
    pts.push({
      coord: coords[j],
      km: cum[j] / 1000,
      eta: new Date(departure.getTime() + frac * duration * 1000),
      kind: k === 0 ? 'origem' : k === n - 1 ? 'destino' : 'trajeto',
    })
  }
  return pts
}

// Hora local (America/Sao_Paulo) no formato da API: "YYYY-MM-DDTHH:00".
function localHourKey(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const g = (t) => parts.find((p) => p.type === t).value
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:00`
}

// Previsão consolidada dos 6 modelos em cada ponto, na hora estimada de passagem.
export async function weatherAlong(points) {
  const lat = points.map((p) => p.coord[1].toFixed(4)).join(',')
  const lon = points.map((p) => p.coord[0].toFixed(4)).join(',')
  const [mod, best] = await Promise.all([
    getJSON(
      `${API}?latitude=${lat}&longitude=${lon}&timezone=${encodeURIComponent(TZ)}&forecast_days=3` +
        `&models=${MODELS.map((m) => m.id).join(',')}&hourly=temperature_2m,precipitation,precipitation_probability,weather_code,wind_gusts_10m`,
    ),
    getJSON(`${API}?latitude=${lat}&longitude=${lon}&timezone=${encodeURIComponent(TZ)}&forecast_days=3&hourly=is_day`),
  ])
  const modArr = Array.isArray(mod) ? mod : [mod]
  const bestArr = Array.isArray(best) ? best : [best]
  return points.map((p, idx) => {
    const m = modArr[idx]
    const i = m.hourly.time.indexOf(localHourKey(p.eta))
    if (i < 0) return { ...p, available: false }
    const pick = (k) => valid(MODELS.map((x) => m.hourly[`${k}_${x.id}`]?.[i]))
    const cats = pick('weather_code').map(categorize)
    const votes = {}
    cats.forEach((c) => (votes[c] = (votes[c] || 0) + 1))
    let condition = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    const mm = stats(pick('precipitation'))
    if ((mm?.median ?? 0) >= 0.3 && condition !== 'tempestade') condition = 'chuva'
    const probs = pick('precipitation_probability')
    const temps = pick('temperature_2m')
    const gusts = pick('wind_gusts_10m')
    return {
      ...p,
      available: true,
      isDay: bestArr[idx]?.hourly?.is_day?.[i] === 1,
      condition,
      agree: votes[condition] ?? 0,
      sources: cats.length,
      temp: temps.length ? median(temps) : null,
      mm,
      probMax: probs.length ? Math.max(...probs) : null,
      gust: gusts.length ? median(gusts) : null,
      storm: cats.filter((c) => c === 'tempestade').length,
    }
  })
}

// Resumo operacional do trajeto.
export function routeSummary(points) {
  const ok = points.filter((p) => p.available)
  if (!ok.length) return 'Previsão indisponível para o horário do trajeto (a previsão cobre até 3 dias).'
  const wet = ok.filter((p) => (p.mm?.median ?? 0) >= 0.3 || (p.probMax ?? 0) >= 60)
  const storm = ok.filter((p) => p.storm >= 2)
  if (!wet.length && !storm.length) return 'Trajeto sem chuva significativa prevista nos horários de passagem.'
  const fmtH = (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
  const first = wet[0] ?? storm[0]
  const last = wet[wet.length - 1] ?? first
  let s =
    first === last
      ? `Chuva provável perto do km ${Math.round(first.km)} (~${fmtH(first.eta)}).`
      : `Chuva provável entre o km ${Math.round(first.km)} (~${fmtH(first.eta)}) e o km ${Math.round(last.km)} (~${fmtH(last.eta)}).`
  if (storm.length) s += ` Risco de trovoada perto do km ${Math.round(storm[0].km)} — reduza a velocidade e evite parar em áreas abertas.`
  return s
}
