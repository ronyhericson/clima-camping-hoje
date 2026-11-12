// Coleta e consolidação meteorológica seguindo a metodologia do
// "Prompt Clima / Chuva (Por outras Bandas)": várias fontes independentes,
// mínimo / máximo / média / mediana, divergências, janelas do dia e laudo por cores.
//
// As fontes numéricas são os modelos globais servidos pela API pública do
// Open-Meteo (sem chave, com CORS). Serviços como Climatempo, AccuWeather,
// Meteored, INMET e Defesa Civil não oferecem API pública para o navegador,
// por isso aparecem como links de conferência no painel — nada é inventado.

export const MODELS = [
  { id: 'ecmwf_ifs025', label: 'ECMWF', origem: 'Centro Europeu' },
  { id: 'gfs_seamless', label: 'GFS', origem: 'NOAA · EUA' },
  { id: 'icon_seamless', label: 'ICON', origem: 'DWD · Alemanha' },
  { id: 'ukmo_seamless', label: 'UKMO', origem: 'Met Office · Reino Unido' },
  { id: 'meteofrance_seamless', label: 'ARPEGE', origem: 'Météo-France' },
  { id: 'jma_seamless', label: 'GSM', origem: 'JMA · Japão' },
]

const API = 'https://api.open-meteo.com/v1/forecast'
const TZ = 'America/Sao_Paulo'

export const RISK = [
  { key: 'verde', label: 'Baixo risco', color: '#16a34a' },
  { key: 'amarelo', label: 'Atenção', color: '#eab308' },
  { key: 'laranja', label: 'Risco elevado', color: '#ea580c' },
  { key: 'vermelho', label: 'Risco muito elevado', color: '#dc2626' },
]

export const CONDITIONS = {
  sol: 'Sol / céu limpo',
  parcial: 'Sol entre nuvens',
  nublado: 'Nublado',
  chuva: 'Chuva',
  tempestade: 'Tempestade',
}

export function categorize(code) {
  if (code == null) return null
  if (code <= 1) return 'sol'
  if (code === 2) return 'parcial'
  if (code === 3 || code === 45 || code === 48) return 'nublado'
  if (code >= 95) return 'tempestade'
  return 'chuva'
}

const WMO = {
  0: 'Céu limpo', 1: 'Predomínio de sol', 2: 'Parcialmente nublado', 3: 'Encoberto',
  45: 'Nevoeiro', 48: 'Nevoeiro com geada', 51: 'Garoa fraca', 53: 'Garoa', 55: 'Garoa forte',
  56: 'Garoa congelante', 57: 'Garoa congelante forte', 61: 'Chuva fraca', 63: 'Chuva moderada',
  65: 'Chuva forte', 66: 'Chuva congelante', 67: 'Chuva congelante forte', 71: 'Neve fraca',
  73: 'Neve', 75: 'Neve forte', 77: 'Grãos de neve', 80: 'Pancadas fracas', 81: 'Pancadas moderadas',
  82: 'Pancadas fortes', 85: 'Pancadas de neve', 86: 'Pancadas de neve fortes', 95: 'Trovoada',
  96: 'Trovoada com granizo', 99: 'Trovoada com granizo forte',
}
export const describeCode = (c) => WMO[c] ?? '—'

// ---------- estatística ----------
export const valid = (arr) => arr.filter((v) => v != null && !Number.isNaN(v))
export const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b)
  if (!s.length) return null
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null)

// Menor intervalo que contém ~60% das fontes ("intervalo de maior concentração").
function concentration(values) {
  const s = [...values].sort((a, b) => a - b)
  if (s.length < 3) return null
  const k = Math.ceil(s.length * 0.6)
  let best = null
  for (let i = 0; i + k - 1 < s.length; i++) {
    const w = s[i + k - 1] - s[i]
    if (!best || w < best.w) best = { lo: s[i], hi: s[i + k - 1], w, n: k }
  }
  return best
}

export function stats(values) {
  const v = valid(values)
  if (!v.length) return null
  const med = median(v)
  const conc = concentration(v)
  // Fora da curva: muito acima/abaixo da mediana (critério absoluto + relativo).
  const outliers = v.filter((x) => Math.abs(x - med) > Math.max(5, med * 1.2))
  return { n: v.length, min: Math.min(...v), max: Math.max(...v), mean: mean(v), median: med, conc, outliers }
}

// ---------- coleta ----------
function chunk(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms))

// Tenta de novo em sobrecarga momentânea (429 / 5xx) ou falha de rede.
export async function getJSON(url, retries = [1500, 4000, 8000]) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url)
      if (r.ok) return r.json()
      if (r.status === 429) {
        // Limite do plano gratuito (por IP). O de minuto passa logo; o de hora/dia não adianta repetir.
        const reason = await r.json().then((d) => d.reason || '').catch(() => '')
        if (/hourly|daily/i.test(reason)) {
          const e = new Error(
            /daily/i.test(reason)
              ? 'limite diário gratuito da Open-Meteo atingido para esta rede; volta a funcionar amanhã'
              : 'limite de consultas por hora da Open-Meteo atingido para esta rede; tente mais tarde',
          )
          e.limit = true
          throw e
        }
      }
      const transient = r.status === 429 || r.status >= 500
      if (!transient || attempt >= retries.length) throw new Error(`Open-Meteo respondeu ${r.status}`)
    } catch (e) {
      if (e.limit || attempt >= retries.length || e.message?.startsWith('Open-Meteo')) throw e
    }
    await sleep(retries[attempt])
  }
}

// Cache no navegador: recarregar a página ou abrir outra aba reaproveita a
// última consulta em vez de gastar a cota gratuita da Open-Meteo (por IP).
const mem = new Map()
function readCache(key) {
  if (mem.has(key)) return mem.get(key)
  try {
    const v = JSON.parse(localStorage.getItem(key))
    if (v?.at) mem.set(key, v)
    return v?.at ? v : null
  } catch {
    return null
  }
}
function writeCache(key, data) {
  const v = { at: Date.now(), data }
  mem.set(key, v)
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {}
  return v
}

// Consulta com cache: usa o salvo se tiver menos de maxAge; se a consulta
// falhar, devolve o último salvo marcado como "stale" (com o horário dele).
export async function cachedFetch(key, maxAge, fn) {
  const hit = readCache(key)
  if (hit && Date.now() - hit.at < maxAge) return { ...hit, fromCache: true }
  try {
    return writeCache(key, await fn())
  } catch (e) {
    if (hit) return { ...hit, stale: true, error: e }
    throw e
  }
}

const asArray = (x) => (Array.isArray(x) ? x : [x])

// As consultas ficam separadas para o Worker (servidor) poder atualizar o
// "tempo agora" com mais frequência (barato) e os 6 modelos com menos
// (cada modelo × cada local conta como uma chamada na Open-Meteo).
const coordsOf = (g) => `latitude=${g.map((c) => c.lat).join(',')}&longitude=${g.map((c) => c.lon).join(',')}&timezone=${encodeURIComponent(TZ)}`

export async function fetchCurrentRaw(campings) {
  const out = []
  for (const g of chunk(campings, 25)) {
    const url =
      `${API}?${coordsOf(g)}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,` +
      `precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m&forecast_days=1`
    out.push(...asArray(await getJSON(url)))
  }
  return out
}

export async function fetchModelsRaw(campings) {
  const out = []
  for (const g of chunk(campings, 25)) {
    const url =
      `${API}?${coordsOf(g)}&models=${MODELS.map((m) => m.id).join(',')}` +
      `&hourly=precipitation,precipitation_probability,weather_code,wind_gusts_10m` +
      `&daily=precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min,wind_gusts_10m_max,weather_code` +
      `&forecast_days=2`
    out.push(...asArray(await getJSON(url)))
  }
  return out
}

export const consolidateAll = (campings, curArr, modArr) => campings.map((c, i) => consolidate(c, curArr[i], modArr[i]))

// Consulta completa direto do navegador (usada quando o Worker não está disponível).
export async function fetchWeather(campings) {
  const [cur, mod] = await Promise.all([fetchCurrentRaw(campings), fetchModelsRaw(campings)])
  return consolidateAll(campings, cur, mod)
}

// Tempo agora + próximas horas do dia corrente para um ponto qualquer.
// "Agora" vem da análise best match; as horas seguintes são consolidadas entre
// os 6 modelos (condição por voto majoritário, chuva pela mediana com faixa
// mín–máx, probabilidade pela maior entre as fontes).
export async function fetchNow(lat, lon) {
  const r = await cachedFetch(`ccj:agora:v1:${(+lat).toFixed(3)},${(+lon).toFixed(3)}`, 30 * 60 * 1000, () => fetchNowLive(lat, lon))
  return r.data
}

async function fetchNowLive(lat, lon) {
  const common = `latitude=${lat}&longitude=${lon}&timezone=${encodeURIComponent(TZ)}&forecast_days=1`
  const [best, mod] = await Promise.all([
    getJSON(`${API}?${common}&current=temperature_2m,is_day,precipitation,weather_code,wind_gusts_10m&hourly=is_day`),
    getJSON(
      `${API}?${common}&models=${MODELS.map((m) => m.id).join(',')}` +
        `&hourly=temperature_2m,precipitation,precipitation_probability,weather_code,wind_gusts_10m`,
    ),
  ])
  const cur = best.current
  const startHour = cur.time.slice(0, 13) + ':00'
  const hours = []
  mod.hourly.time.forEach((t, i) => {
    if (t <= startHour) return // só as próximas horas, até 23h de hoje
    const pick = (k) => valid(MODELS.map((m) => mod.hourly[`${k}_${m.id}`]?.[i]))
    const cats = pick('weather_code').map(categorize)
    const votes = {}
    cats.forEach((c) => (votes[c] = (votes[c] || 0) + 1))
    let condition = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    const mm = stats(pick('precipitation'))
    if ((mm?.median ?? 0) >= 0.3 && condition !== 'tempestade') condition = 'chuva'
    const probs = pick('precipitation_probability')
    const temps = pick('temperature_2m')
    const gusts = pick('wind_gusts_10m')
    hours.push({
      hour: Number(t.slice(11, 13)),
      isDay: best.hourly.is_day[i] === 1,
      condition,
      agree: votes[condition] ?? 0,
      sources: cats.length,
      temp: temps.length ? median(temps) : null,
      mm,
      probMax: probs.length ? Math.max(...probs) : null,
      gust: gusts.length ? median(gusts) : null,
      storm: cats.filter((c) => c === 'tempestade').length,
    })
  })
  return { ...cur, hours }
}

// ---------- consolidação ----------
const PERIODS = [
  { key: 'madrugada', label: 'Madrugada', from: 0, to: 6 },
  { key: 'manha', label: 'Manhã', from: 6, to: 12 },
  { key: 'iniTarde', label: 'Início da tarde', from: 12, to: 15 },
  { key: 'fimTarde', label: 'Fim da tarde', from: 15, to: 18 },
  { key: 'noite', label: 'Noite', from: 18, to: 24 },
]

function consolidate(camping, cur, mod) {
  const now = cur.current
  const today = mod.daily.time[0]
  const hourStr = now.time.slice(0, 13) + ':00'
  const hIdx = mod.hourly.time.indexOf(hourStr)
  const curHour = Number(now.time.slice(11, 13))

  const perModel = MODELS.map((m) => {
    const h = (k) => mod.hourly[`${k}_${m.id}`]
    const d = (k) => mod.daily[`${k}_${m.id}`]?.[0] ?? null
    const codeNow = hIdx >= 0 ? h('weather_code')?.[hIdx] ?? null : null
    // Horas restantes de hoje para esta fonte.
    const rest = []
    for (let i = Math.max(hIdx, 0); i < mod.hourly.time.length; i++) {
      if (!mod.hourly.time[i].startsWith(today)) break
      rest.push({
        hour: Number(mod.hourly.time[i].slice(11, 13)),
        mm: h('precipitation')?.[i] ?? null,
        prob: h('precipitation_probability')?.[i] ?? null,
        code: h('weather_code')?.[i] ?? null,
        gust: h('wind_gusts_10m')?.[i] ?? null,
      })
    }
    const periods = PERIODS.map((p) => {
      const hrs = []
      for (let i = 0; i < mod.hourly.time.length; i++) {
        const t = mod.hourly.time[i]
        if (!t.startsWith(today)) continue
        const hr = Number(t.slice(11, 13))
        if (hr >= p.from && hr < p.to) hrs.push(i)
      }
      const mmv = valid(hrs.map((i) => h('precipitation')?.[i]))
      const pv = valid(hrs.map((i) => h('precipitation_probability')?.[i]))
      const storm = hrs.some((i) => (h('weather_code')?.[i] ?? 0) >= 95)
      return {
        mm: mmv.length ? mmv.reduce((a, b) => a + b, 0) : null,
        prob: pv.length ? Math.max(...pv) : null,
        storm,
      }
    })
    const firstRain = rest.find((r) => (r.mm ?? 0) >= 0.5)
    return {
      ...m,
      codeNow,
      catNow: categorize(codeNow),
      mmNow: hIdx >= 0 ? h('precipitation')?.[hIdx] ?? null : null,
      daySum: d('precipitation_sum'),
      probMax: d('precipitation_probability_max'),
      tMax: d('temperature_2m_max'),
      tMin: d('temperature_2m_min'),
      gustMax: d('wind_gusts_10m_max'),
      dayCode: d('weather_code'),
      stormRest: rest.some((r) => (r.code ?? 0) >= 95),
      firstRainHour: firstRain ? firstRain.hour : null,
      periods,
      available: d('precipitation_sum') != null || codeNow != null,
    }
  })

  const avail = perModel.filter((m) => m.available)

  // "Tempo agora": voto majoritário entre as fontes na hora corrente,
  // desempate pela observação/análise "best match" do Open-Meteo.
  const bestCat = categorize(now.weather_code)
  const votes = {}
  avail.forEach((m) => m.catNow && (votes[m.catNow] = (votes[m.catNow] || 0) + 1))
  let condition = bestCat
  let top = 0
  Object.entries(votes).forEach(([k, n]) => {
    if (n > top || (n === top && k === bestCat)) {
      top = n
      condition = k
    }
  })
  // Precipitação medida/analisada agora sempre prevalece sobre "seco".
  if ((now.precipitation ?? 0) >= 0.2 && !['chuva', 'tempestade'].includes(condition)) condition = 'chuva'
  const wet = (c) => c === 'chuva' || c === 'tempestade'
  const agreeing = avail.filter((m) => m.catNow && wet(m.catNow) === wet(condition)).length

  const rain = stats(avail.map((m) => m.daySum))
  const prob = stats(avail.map((m) => m.probMax))
  const tMax = stats(avail.map((m) => m.tMax))
  const tMin = stats(avail.map((m) => m.tMin))
  const gust = stats(avail.map((m) => m.gustMax))
  const stormModels = avail.filter((m) => m.stormRest).length
  const firstRainHours = valid(avail.map((m) => m.firstRainHour))

  const periods = PERIODS.map((p, i) => {
    const mm = stats(avail.map((m) => m.periods[i].mm))
    const pr = valid(avail.map((m) => m.periods[i].prob))
    const storm = avail.filter((m) => m.periods[i].storm).length
    return { ...p, past: p.to <= curHour, mm, probMax: pr.length ? Math.max(...pr) : null, storm }
  })

  // ---------- laudo de risco por cores (seção 14) ----------
  const reasons = []
  const gustMed = gust?.median ?? 0
  const rainMed = rain?.median ?? 0
  let level = 0
  const bump = (lv, why) => {
    if (lv > level) level = lv
    reasons.push(why)
  }
  if (condition === 'tempestade') bump(2, 'Trovoada indicada para a hora atual')
  if (stormModels >= 4 && gustMed >= 70) bump(3, `${stormModels} fontes com trovoada e rajadas medianas de ${Math.round(gustMed)} km/h`)
  if (gustMed >= 75) bump(3, `Rajadas medianas de ${Math.round(gustMed)} km/h`)
  if (stormModels >= 3) bump(2, `${stormModels} de ${avail.length} fontes indicam trovoada no restante do dia`)
  else if (stormModels >= 1) bump(1, `${stormModels} fonte(s) indica(m) trovoada isolada`)
  if (gustMed >= 55) bump(2, `Rajadas medianas de ${Math.round(gustMed)} km/h`)
  else if (gustMed >= 40) bump(1, `Rajadas medianas de ${Math.round(gustMed)} km/h`)
  if (rainMed >= 30) bump(2, `Acumulado central de ~${Math.round(rainMed)} mm`)
  else if (rainMed >= 5) bump(1, `Acumulado central de ~${Math.round(rainMed)} mm`)
  if ((prob?.median ?? 0) >= 60 && level < 1) bump(1, `Probabilidade de chuva elevada (${Math.round(prob.median)}%)`)
  if (!reasons.length) reasons.push('Sem indicação relevante de tempestade, chuva volumosa ou vento perigoso')

  // ---------- grau de confiança ----------
  let confidence = 'moderada'
  const spread = rain ? rain.max - rain.min : 0
  if (avail.length >= 4 && agreeing >= avail.length - 1 && spread <= Math.max(5, rainMed)) confidence = 'alta'
  if (avail.length < 3 || agreeing <= avail.length / 2 || (rain && rain.outliers.length >= 2)) confidence = 'baixa'

  // ---------- tipo de chuva (seção 7) ----------
  let rainType = 'Sem chuva relevante prevista'
  const wetPeriods = periods.filter((p) => (p.mm?.median ?? 0) >= 0.5).length
  if (rainMed >= 0.5) {
    if (wetPeriods >= 4) rainType = 'Chuva persistente / generalizada'
    else if (wetPeriods >= 2) rainType = 'Chuva intermitente'
    else rainType = 'Chuva isolada'
    if (stormModels >= 2) rainType += ', com risco de temporal localizado'
  }

  return {
    camping,
    updatedAt: now.time,
    today,
    now: {
      temp: now.temperature_2m,
      feels: now.apparent_temperature,
      humidity: now.relative_humidity_2m,
      isDay: now.is_day === 1,
      precip: now.precipitation,
      code: now.weather_code,
      cloud: now.cloud_cover,
      wind: now.wind_speed_10m,
      windDir: now.wind_direction_10m,
      gust: now.wind_gusts_10m,
    },
    condition,
    agreeing,
    sources: avail.length,
    perModel,
    rain,
    prob,
    tMax,
    tMin,
    gust,
    stormModels,
    firstRainEarliest: firstRainHours.length ? Math.min(...firstRainHours) : null,
    firstRainLatest: firstRainHours.length ? Math.max(...firstRainHours) : null,
    periods,
    risk: level,
    reasons: [...new Set(reasons)],
    confidence,
    rainType,
  }
}

// Conclusão operacional (seção 19): quando, quanto, tipo, risco, o que fazer.
export function conclusion(w) {
  const parts = []
  const dry = w.periods.filter((p) => !p.past && (p.probMax ?? 0) < 30 && (p.mm?.median ?? 0) < 0.3)
  const wet = w.periods.filter((p) => !p.past && ((p.mm?.median ?? 0) >= 0.5 || p.storm >= 2))
  if (w.firstRainEarliest != null) {
    const a = w.firstRainEarliest
    const b = w.firstRainLatest
    parts.push(
      a === b
        ? `As fontes indicam início de chuva por volta das ${a}h.`
        : `As fontes divergem no horário: a mais antecipada indica chuva a partir das ${a}h e a mais tardia às ${b}h — para planejamento preventivo, considere ${a}h.`,
    )
  } else {
    parts.push('Nenhuma fonte indica chuva significativa (≥ 0,5 mm/h) no restante do dia.')
  }
  if (w.rain && w.rain.max >= 0.5) {
    const c = w.rain.conc
    const central = c ? `${fmt(c.lo)}–${fmt(c.hi)} mm` : `~${fmt(w.rain.median)} mm`
    let s = `Estimativa central de ${central} no dia (mediana ${fmt(w.rain.median)} mm, faixa ${fmt(w.rain.min)}–${fmt(w.rain.max)} mm).`
    if (w.rain.outliers.length) s += ' Há fonte com cenário bem diferente das demais — não trate a média como previsão exata.'
    parts.push(s)
  }
  parts.push(`${w.rainType}.`)
  if (dry.length) parts.push(`Janela mais favorável para montagem/desmontagem: ${dry.map((p) => p.label.toLowerCase()).join(', ')}.`)
  else if (wet.length) parts.push('Não há janela confiavelmente seca no restante do dia.')
  if (w.stormModels >= 1 || (w.gust?.median ?? 0) >= 40)
    parts.push('Verifique estacas, tirantes e coberturas antes da instabilidade; em caso de raios, abrigue-se em construção fechada ou veículo de teto rígido.')
  return parts.join(' ')
}

export const fmt = (v, d = 1) =>
  v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: 0 })
