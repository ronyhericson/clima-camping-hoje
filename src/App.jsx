import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MapView from './MapView.jsx'
import MunicipioSearch from './MunicipioSearch.jsx'
import CityMap from './CityMap.jsx'
import RouteModal from './RouteModal.jsx'
import RouteMap from './RouteMap.jsx'
import AboutModal from './AboutModal.jsx'
import Forecast5Modal from './Forecast5Modal.jsx'
import { fetchRoute, checkpoints, weatherAlong } from './routing.js'
import { CAMPINGS } from './data/campings.js'
import MUNICIPIOS from './data/sp-municipios.json'
import { fetchWeather, fetchNow, cachedFetch, categorize, RISK, CONDITIONS, describeCode, conclusion, fmt } from './weather.js'
import { iconSrc } from './icons.js'

// Cada consulta completa custa ~7 chamadas por camping na Open-Meteo (6 modelos + tempo agora),
// e o plano gratuito permite 10.000 por dia por IP. Por isso: cache no navegador,
// atualização automática a cada 1 h só com a aba visível, e botão limitado a 1 vez a cada 10 min.
const REFRESH_MS = 60 * 60 * 1000
const MANUAL_MIN_MS = 10 * 60 * 1000
// Clima consolidado pelo Worker (/api/clima). Só vale se for JSON recente e com
// os mesmos campings deste build; senão o site consulta direto a Open-Meteo
// (e, se essa consulta também falhar, mostra o dado antigo do servidor).
const SERVER_MAX_AGE = 2 * 60 * 60 * 1000
async function fetchServerWeather() {
  try {
    const r = await fetch('/api/clima', { headers: { accept: 'application/json' } })
    if (!r.ok || !r.headers.get('content-type')?.includes('json')) return null
    const d = await r.json()
    const ids = new Set(d.data?.map((x) => x.camping.id))
    const sameList = ids.size === CAMPINGS.length && CAMPINGS.every((c) => ids.has(c.id))
    return sameList ? { ...d, fresh: Date.now() - d.at < SERVER_MAX_AGE } : null
  } catch {
    return null
  }
}

// A chave muda quando a lista de campings ou as coordenadas mudam.
const WEATHER_KEY = `ccj:clima:v1:${[...CAMPINGS.map((c) => `${c.id}@${c.lat},${c.lon}`).join('|')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7).toString(36)}`
const isNarrow = () => typeof window !== 'undefined' && window.innerWidth < 900

function useDark() {
  const q = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null
  const [dark, setDark] = useState(q?.matches ?? false)
  useEffect(() => {
    if (!q) return
    const h = (e) => setDark(e.matches)
    q.addEventListener('change', h)
    return () => q.removeEventListener('change', h)
  }, [])
  return dark
}

const fmtDateTime = (iso) => {
  if (!iso) return '—'
  const [d, t] = iso.split('T')
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y} ${t.slice(0, 5)}`
}

const shortDate = () => {
  const s = new Date().toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'America/Sao_Paulo' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const todayLabel = () => {
  const s = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function RiskBadge({ level }) {
  const r = RISK[level]
  return (
    <span className="badge" style={{ background: r.color }}>
      {r.key.toUpperCase()} · {r.label}
    </span>
  )
}

const range = (s, unit, d = 1) => (s ? (s.min === s.max ? `${fmt(s.min, d)} ${unit}` : `${fmt(s.min, d)}–${fmt(s.max, d)} ${unit}`) : 'indisponível')

function Detail({ w, onClose }) {
  const c = w.camping
  const q = encodeURIComponent(`${c.municipio} SP`)
  return (
    <div className="detail">
      <header className="detail-head">
        <img src={iconSrc(w.condition, w.now.isDay)} alt="" width="56" height="56" />
        <div>
          <h2>{c.nome}</h2>
          <p className="muted">
            {c.municipio} · SP · {c.mesorregiao}
          </p>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Fechar">
          ✕
        </button>
      </header>

      <RiskBadge level={w.risk} />
      <p className="muted small">
        Atualização dos modelos: {fmtDateTime(w.updatedAt)} (horário de Brasília) · Confiança <b>{w.confidence}</b>
      </p>

      <section className="now">
        <div className="big">{fmt(w.now.temp)}°C</div>
        <div>
          <b>{CONDITIONS[w.condition]}</b> agora
          <div className="muted small">
            {w.agreeing} de {w.sources} fontes concordam (seco × chuva) · análise atual: {describeCode(w.now.code)}
          </div>
        </div>
        <dl className="kv">
          <div><dt>Sensação</dt><dd>{fmt(w.now.feels)}°C</dd></div>
          <div><dt>Chuva agora</dt><dd>{fmt(w.now.precip)} mm</dd></div>
          <div><dt>Nuvens</dt><dd>{fmt(w.now.cloud, 0)}%</dd></div>
          <div><dt>Umidade</dt><dd>{fmt(w.now.humidity, 0)}%</dd></div>
          <div><dt>Vento</dt><dd>{fmt(w.now.wind, 0)} km/h</dd></div>
          <div><dt>Rajada</dt><dd>{fmt(w.now.gust, 0)} km/h</dd></div>
        </dl>
      </section>

      <section>
        <h3>Laudo do dia</h3>
        <p>{conclusion(w)}</p>
        <ul className="reasons">
          {w.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Quadro consolidado — hoje</h3>
        <dl className="kv wide">
          <div><dt>Chuva (mediana)</dt><dd>{fmt(w.rain?.median)} mm</dd></div>
          <div><dt>Chuva (faixa)</dt><dd>{range(w.rain, 'mm')}</dd></div>
          <div><dt>Média aritmética</dt><dd>{fmt(w.rain?.mean)} mm</dd></div>
          <div><dt>Maior concentração</dt><dd>{w.rain?.conc ? `${fmt(w.rain.conc.lo)}–${fmt(w.rain.conc.hi)} mm (${w.rain.conc.n} fontes)` : '—'}</dd></div>
          <div><dt>Prob. de chuva</dt><dd>{range(w.prob, '%', 0)}</dd></div>
          <div><dt>Mínima / máxima</dt><dd>{fmt(w.tMin?.median, 0)}° / {fmt(w.tMax?.median, 0)}°</dd></div>
          <div><dt>Rajadas máx.</dt><dd>{range(w.gust, 'km/h', 0)}</dd></div>
          <div><dt>Tipo</dt><dd>{w.rainType}</dd></div>
        </dl>
        <p className="muted small">
          Probabilidade de chuva alta indica convergência sobre ocorrer <i>alguma</i> precipitação, não que choverá o dia todo.
        </p>
      </section>

      <section>
        <h3>Períodos do dia</h3>
        <table>
          <thead>
            <tr><th>Período</th><th>Chuva (mediana)</th><th>Prob. máx.</th><th>Trovoada</th></tr>
          </thead>
          <tbody>
            {w.periods.map((p) => (
              <tr key={p.key} className={p.past ? 'past' : ''}>
                <td>{p.label} <span className="muted small">{p.from}h–{p.to}h</span></td>
                <td>{fmt(p.mm?.median)} mm</td>
                <td>{p.probMax == null ? '—' : `${p.probMax}%`}</td>
                <td>{p.storm ? `${p.storm} fonte(s)` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3>Comparativo de fontes</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Fonte</th><th>Agora</th><th>Chuva dia</th><th>Prob.</th><th>Mín/Máx</th><th>Rajada</th></tr>
            </thead>
            <tbody>
              {w.perModel.map((m) => (
                <tr key={m.id} className={m.available ? '' : 'past'}>
                  <td><b>{m.label}</b><div className="muted small">{m.origem}</div></td>
                  <td>{m.catNow ? <img src={iconSrc(m.catNow, w.now.isDay)} alt={CONDITIONS[m.catNow]} title={describeCode(m.codeNow)} width="26" height="26" /> : '—'}</td>
                  <td className={w.rain?.outliers.includes(m.daySum) ? 'outlier' : ''}>{fmt(m.daySum)} mm</td>
                  <td>{m.probMax == null ? 'n/d' : `${m.probMax}%`}</td>
                  <td>{fmt(m.tMin, 0)}°/{fmt(m.tMax, 0)}°</td>
                  <td>{m.gustMax == null ? 'n/d' : `${fmt(m.gustMax, 0)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          Valores em destaque divergem muito da mediana. "n/d" = a fonte não publica esse dado.
        </p>
      </section>

      <section>
        <h3>Confira também</h3>
        <div className="links">
          <a href={`https://www.climatempo.com.br/busca?q=${q}`} target="_blank" rel="noreferrer">Climatempo</a>
          <a href={`https://www.tempo.com/busca.htm?q=${q}`} target="_blank" rel="noreferrer">Meteored</a>
          <a href={`https://www.accuweather.com/pt/search-locations?query=${q}`} target="_blank" rel="noreferrer">AccuWeather</a>
          <a href="https://alertas2.inmet.gov.br/" target="_blank" rel="noreferrer">Alertas INMET</a>
          <a href="https://www.defesacivil.sp.gov.br/" target="_blank" rel="noreferrer">Defesa Civil SP</a>
          <a href="https://www.ipmetradar.com.br/" target="_blank" rel="noreferrer">Radar IPMet</a>
          <a href="https://previsao.cptec.inpe.br/" target="_blank" rel="noreferrer">CPTEC/INPE</a>
          <a href={`https://www.windy.com/${c.lat}/${c.lon}?${c.lat},${c.lon},10`} target="_blank" rel="noreferrer">Windy</a>
        </div>
        {c.fonte && (
          <p className="muted small">
            Camping: <a href={c.fonte} target="_blank" rel="noreferrer">referência</a>
            {c.local ? ` · ${c.local}` : ''}
            {c.coord === 'municipio' ? ' · coordenada aproximada (centro do município)' : ''}
            {c.coord === 'bairro' ? ' · coordenada aproximada (bairro)' : ''}
          </p>
        )}
      </section>

      {(w.stormModels > 0 || w.condition === 'tempestade') && (
        <section className="safety">
          <h3>Segurança em tempestades</h3>
          <p>
            Barracas, gazebos e tarps não protegem contra raios. Interrompa atividades externas, procure construção fechada ou veículo de teto
            rígido, evite árvores isoladas e não desmonte estruturas durante vento forte ou descargas elétricas.
          </p>
        </section>
      )}
    </div>
  )
}

const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

function Overview({ results, onSelect, query, setQuery }) {
  const q = norm(query)
  const sorted = [...results]
    .filter((r) => !q || [r.camping.nome, r.camping.municipio, r.camping.mesorregiao].some((t) => norm(t).includes(q)))
    .sort((a, b) => b.risk - a.risk || (b.rain?.median ?? 0) - (a.rain?.median ?? 0))
  const counts = {}
  results.forEach((r) => (counts[r.condition] = (counts[r.condition] || 0) + 1))
  return (
    <div className="overview">
      <div className="summary-icons">
        {Object.keys(CONDITIONS)
          .filter((k) => counts[k])
          .map((k) => (
            <span key={k} title={CONDITIONS[k]}>
              <img src={iconSrc(k, true)} alt="" width="22" height="22" /> {counts[k]}
            </span>
          ))}
      </div>
      <div className="camp-search">
        <span className="search-icon" aria-hidden="true">⌕</span>
        <input
          type="search"
          placeholder="Buscar camping, cidade ou região…"
          aria-label="Buscar camping"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && sorted.length === 1) onSelect(sorted[0].camping.id)
            if (e.key === 'Escape') setQuery('')
          }}
          autoComplete="off"
          spellCheck="false"
        />
        {query && (
          <button className="search-clear" onClick={() => setQuery('')} aria-label="Limpar busca de camping">
            ✕
          </button>
        )}
      </div>
      {q && (
        <p className="muted small camp-count">
          {sorted.length} de {results.length} campings
        </p>
      )}
      {q && !sorted.length && <p className="muted">Nenhum camping encontrado para “{query}”.</p>}
      <ul className="list">
        {sorted.map((r) => (
          <li key={r.camping.id}>
            <button onClick={() => onSelect(r.camping.id)}>
              <img src={iconSrc(r.condition, r.now.isDay)} alt={CONDITIONS[r.condition]} width="34" height="34" />
              <span className="grow">
                <b>{r.camping.nome}</b>
                <span className="muted small">{r.camping.municipio} · {CONDITIONS[r.condition]}</span>
              </span>
              <span className="temp">{fmt(r.now.temp, 0)}°</span>
              <span className="dot" style={{ background: RISK[r.risk].color }} title={RISK[r.risk].label} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function distKm([lon1, lat1], [lon2, lat2]) {
  const R = 6371
  const toRad = (d) => (d * Math.PI) / 180
  const a =
    Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// Resumo operacional das próximas horas (seção 19 do prompt: quando vai chover?).
function hourlySummary(hours) {
  const wet = hours.filter((h) => (h.mm?.median ?? 0) >= 0.3 || (h.probMax ?? 0) >= 60)
  const storm = hours.filter((h) => h.storm >= 2)
  if (!wet.length) return 'Sem chuva significativa indicada pelos modelos no restante do dia.'
  const first = wet[0].hour
  const last = wet[wet.length - 1].hour
  const total = hours.reduce((s, h) => s + (h.mm?.median ?? 0), 0)
  let s =
    first === last
      ? `Chuva mais provável por volta das ${first}h`
      : `Chuva mais provável entre ${first}h e ${last >= 23 ? 'o fim do dia' : `${last + 1}h`}`
  s += total >= 0.5 ? ` (~${fmt(total)} mm na mediana das fontes).` : ', em volumes baixos.'
  if (storm.length) s += ` Risco de trovoada a partir das ${storm[0].hour}h.`
  return s
}

function HourlyStrip({ hours }) {
  if (!hours?.length)
    return <p className="muted small hourly-empty">O dia está terminando — não há mais horas de hoje para prever.</p>
  return (
    <div className="hourly">
      <div className="muted small label">Próximas horas de hoje</div>
      <p className="small hourly-summary">{hourlySummary(hours)}</p>
      <ol className="hourly-strip">
        {hours.map((h) => {
          const wet = (h.mm?.median ?? 0) >= 0.3
          const title =
            `${h.hour}h · ${CONDITIONS[h.condition] ?? '—'} (${h.agree}/${h.sources} fontes)` +
            ` · chuva ${fmt(h.mm?.median)} mm (faixa ${fmt(h.mm?.min)}–${fmt(h.mm?.max)})` +
            (h.probMax != null ? ` · prob. até ${h.probMax}%` : '') +
            (h.gust != null ? ` · rajada ${fmt(h.gust, 0)} km/h` : '')
          return (
            <li key={h.hour} className={`${wet ? 'wet' : ''} ${h.storm >= 2 ? 'storm' : ''}`} title={title}>
              <span className="h">{h.hour}h</span>
              <img src={iconSrc(h.condition, h.isDay)} alt={CONDITIONS[h.condition] ?? ''} width="30" height="30" />
              <span className="t">{fmt(h.temp, 0)}°</span>
              <span className="p">
                <i style={{ height: `${h.probMax ?? 0}%` }} />
              </span>
              <span className="pv">{h.probMax == null ? '—' : `${h.probMax}%`}</span>
              <span className="mm">{(h.mm?.median ?? 0) >= 0.1 ? `${fmt(h.mm.median)}mm` : ''}</span>
            </li>
          )
        })}
      </ol>
      <p className="muted small">Mediana de 6 modelos · barra = maior probabilidade de chuva entre as fontes.</p>
    </div>
  )
}

function CampList({ items, onSelect }) {
  return (
    <ul className="list compact">
      {items.map(({ r, d }) => (
        <li key={r.camping.id}>
          <button onClick={() => onSelect(r.camping.id)}>
            <img src={iconSrc(r.condition, r.now.isDay)} alt={CONDITIONS[r.condition]} width="26" height="26" />
            <span className="grow">
              <b>{r.camping.nome}</b>
              <span className="muted small">{r.camping.municipio} · {fmt(d, 0)} km do centro · {fmt(r.now.temp, 0)}°C</span>
            </span>
            <span className="dot" style={{ background: RISK[r.risk].color }} title={RISK[r.risk].label} />
          </button>
        </li>
      ))}
    </ul>
  )
}

function MunicipioCard({ m, results, onSelectCamping, onClose }) {
  const [now, setNow] = useState(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    let alive = true
    setNow(null)
    setErr(false)
    fetchNow(m.c[1], m.c[0])
      .then((d) => alive && setNow(d))
      .catch(() => alive && setErr(true))
    return () => {
      alive = false
    }
  }, [m.id])
  // Campings mapeados no próprio município (todos) e, abaixo, os mais próximos de outras cidades.
  const byDist = results
    .map((r) => ({ r, d: distKm(m.c, [r.camping.lon, r.camping.lat]) }))
    .sort((a, b) => a.d - b.d)
  const inCity = byDist.filter(({ r }) => normName(r.camping.municipio) === normName(m.nome))
  const nearest = byDist.filter((x) => !inCity.includes(x)).slice(0, inCity.length ? 2 : 3)
  let cat = now ? categorize(now.weather_code) : null
  // Chuva analisada agora prevalece sobre um código "seco".
  if (cat && cat !== 'tempestade' && (now.precipitation ?? 0) >= 0.2) cat = 'chuva'
  return (
    <div className="muni-card" role="region" aria-label={`Município ${m.nome}`}>
      <div className="muni-head">
        <span className="muni-pin" aria-hidden="true" />
        <div className="grow">
          <b>{m.nome}</b>
          <span className="muted small">
            {m.meso} · {m.pop.toLocaleString('pt-BR')} hab.
          </span>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Remover destaque">
          ✕
        </button>
      </div>
      <div className="muni-now">
        {now ? (
          <>
            <img src={iconSrc(cat, now.is_day === 1)} alt="" width="44" height="44" />
            <div>
              <div className="temp">{fmt(now.temperature_2m)}°C</div>
              <div className="small">{describeCode(now.weather_code)} agora</div>
            </div>
            <dl className="mini">
              <div><dt>Chuva</dt><dd>{fmt(now.precipitation)} mm</dd></div>
              <div><dt>Rajada</dt><dd>{fmt(now.wind_gusts_10m, 0)} km/h</dd></div>
            </dl>
          </>
        ) : err ? (
          <span className="muted small">Tempo agora indisponível no momento.</span>
        ) : (
          <span className="muted small">Consultando o tempo agora…</span>
        )}
      </div>
      {now && <HourlyStrip hours={now.hours} />}
      {inCity.length > 0 && (
        <>
          <div className="muted small label">
            {inCity.length === 1 ? '1 camping mapeado' : `${inCity.length} campings mapeados`} em {m.nome}
          </div>
          <CampList items={inCity} onSelect={onSelectCamping} />
        </>
      )}
      {nearest.length > 0 && (
        <>
          <div className="muted small label">{inCity.length ? 'Também perto' : 'Campings mais próximos'}</div>
          <CampList items={nearest} onSelect={onSelectCamping} />
        </>
      )}
    </div>
  )
}

const normName = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

export default function App() {
  const dark = useDark()
  const [results, setResults] = useState([])
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const hasData = useRef(false)
  const [selected, setSelected] = useState(null)
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 900)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('ccj:painelRecolhido') === '1'
    } catch {
      return false
    }
  })
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem('ccj:painelRecolhido', c ? '0' : '1')
      } catch {}
      return !c
    })
  const [fetchedAt, setFetchedAt] = useState(null)
  const [municipio, setMunicipio] = useState(null)
  const [campQuery, setCampQuery] = useState('')
  const [cityView, setCityView] = useState(null) // null | 'ruas' | '3d'
  const [routeModal, setRouteModal] = useState(false)
  const [forecast5, setForecast5] = useState(null) // lugar aberto no modal "Próximos 5 dias"
  const closeForecast5 = useCallback(() => setForecast5(null), [])
  // Janela "Sobre, créditos e privacidade" (também abre pelo link direto /#sobre).
  const [about, setAbout] = useState(() => typeof window !== 'undefined' && window.location.hash === '#sobre')
  const closeAbout = useCallback(() => {
    setAbout(false)
    if (window.location.hash === '#sobre') history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [])
  const [routeBusy, setRouteBusy] = useState(false)
  const [routeError, setRouteError] = useState(null)
  const [route, setRoute] = useState(null)
  const [routeView, setRouteView] = useState(false)

  const traceRoute = async ({ from, to, departure }) => {
    setRouteBusy(true)
    setRouteError(null)
    try {
      const r = await fetchRoute(from.coord, to.coord)
      const pts = checkpoints(r, departure)
      let points
      try {
        points = await weatherAlong(pts)
      } catch {
        points = pts.map((p) => ({ ...p, available: false }))
      }
      setRoute({ ...r, from, to, departure, points })
      setRouteModal(false)
      setRouteView(true)
      setCityView(null)
    } catch (e) {
      setRouteError(e.message || 'Não foi possível traçar a rota agora.')
    } finally {
      setRouteBusy(false)
    }
  }

  const selectedCamping = CAMPINGS.find((c) => c.id === selected)
  const defaultDestination = selectedCamping
    ? { label: selectedCamping.nome, detail: `${selectedCamping.municipio} · camping monitorado`, coord: [selectedCamping.lon, selectedCamping.lat], campingId: selectedCamping.id, kind: 'camping' }
    : null
  useEffect(() => setCityView(null), [municipio?.id])

  const load = useCallback(async (force = false) => {
    setStatus((s) => (s === 'ready' ? 'refreshing' : 'loading'))
    try {
      // 1º: dados do servidor (Worker na Cloudflare), atualizados a cada 30 min para todos os visitantes.
      const server = await fetchServerWeather()
      if (server?.fresh) {
        hasData.current = true
        setResults(server.data)
        setFetchedAt(new Date(server.at))
        // Fonte reserva em uso no Worker: detalhe só no console.
        if (server.aviso) console.warn('[Clima]', server.aviso)
        setError(null)
        setStatus('ready')
        return
      }
      // Reserva: consulta direto do navegador (ex.: rodando local com Docker), com cache.
      const maxAge = force ? MANUAL_MIN_MS : REFRESH_MS
      let r
      try {
        r = await cachedFetch(WEATHER_KEY, maxAge, () => fetchWeather(CAMPINGS))
      } catch (e) {
        if (!server) throw e
        r = { at: server.at, data: server.data, stale: true, error: e }
      }
      // Se o salvo no navegador for mais antigo que o do servidor, usa o do servidor.
      if (r.stale && server && server.at > r.at) r = { ...r, at: server.at, data: server.data }
      setResults(r.data)
      setFetchedAt(new Date(r.at))
      // Detalhes técnicos (limite da API, dado antigo) ficam só no console.
      if (r.stale) console.warn('[Clima]', `${r.error.message}; mostrando a consulta de ${new Date(r.at).toLocaleString('pt-BR')}`)
      hasData.current = true
      setError(null)
      setStatus('ready')
    } catch (e) {
      console.error('[Clima]', e)
      // Com dados na tela, segue mostrando os anteriores sem alarde; sem nada, avisa.
      setError(hasData.current ? null : 'sem-dados')
      setStatus((s) => (s === 'refreshing' ? 'ready' : 'error'))
    }
  }, [])

  // Atualiza só com a aba visível (aba esquecida aberta não gasta a cota).
  useEffect(() => {
    load()
    const tick = () => document.visibilityState === 'visible' && load()
    const id = setInterval(tick, 5 * 60 * 1000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [load])

  const current = useMemo(() => results.find((r) => r.camping.id === selected), [results, selected])
  // O laudo abre sempre do início (o painel guardava a rolagem da lista).
  const panelRef = useRef(null)
  useEffect(() => {
    if (panelRef.current) panelRef.current.scrollTop = 0
  }, [selected])

  // Ao abrir um camping, destaca e enquadra o município dele (mesmo efeito da busca por município).
  const select = (id) => {
    setSelected(id)
    setPanelOpen(true)
    const c = CAMPINGS.find((x) => x.id === id)
    const key = normName(c?.municipio)
    const m = key && MUNICIPIOS.find((x) => normName(x.nome) === key)
    if (m) setMunicipio((cur) => (cur?.id === m.id ? cur : m))
  }

  return (
    <div className="app">
      <MapView results={results} selectedId={selected} onSelect={select} dark={dark} municipio={municipio} route={route} />

      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true"><img src="/favicon.svg" alt="" /></span>
          <div>
            <h1>Clima<span>Camping</span>Hoje</h1>
            <p className="muted small">
              <span className="hide-sm">{todayLabel()} · tempo agora nos campings de SP</span>
              <span className="show-sm">{shortDate()} · tempo agora nos campings</span>
            </p>
          </div>
        </div>
        <MunicipioSearch
          selected={municipio}
          onSelect={(m) => {
            setMunicipio(m)
            if (m && isNarrow()) setPanelOpen(false)
          }}
        />
        <div className="actions">
          <button
            className="btn"
            onClick={() => load(true)}
            disabled={status === 'loading' || status === 'refreshing'}
            aria-label="Atualizar previsões"
            title="Atualizar previsões"
          >
            <span aria-hidden="true" className={status === 'refreshing' || status === 'loading' ? 'spin' : ''}>↻</span>
            <span className="btn-label">{status === 'refreshing' || status === 'loading' ? 'Atualizando…' : 'Atualizar'}</span>
          </button>
          <button
            className={`btn ${panelOpen ? 'active' : ''}`}
            onClick={() => {
              if (!panelOpen && collapsed) toggleCollapsed()
              setPanelOpen((o) => !o)
            }}
            aria-expanded={panelOpen}
            aria-label={panelOpen ? 'Ocultar painel de campings' : 'Mostrar campings'}
            title={panelOpen ? 'Ocultar painel de campings' : 'Mostrar campings'}
          >
            <span aria-hidden="true">☰</span>
            <span className="btn-label">{panelOpen ? 'Ocultar painel' : 'Campings'}</span>
          </button>
        </div>
      </header>

      {!cityView && !routeView && (
        <div className="fabs" role="group" aria-label="Ações do mapa">
          {(selectedCamping || municipio) && (
            <button
              className="fab forecast"
              onClick={() =>
                setForecast5(
                  selectedCamping
                    ? { kind: 'camping', nome: selectedCamping.nome, detalhe: selectedCamping.municipio, lat: selectedCamping.lat, lon: selectedCamping.lon }
                    : { kind: 'municipio', nome: municipio.nome, detalhe: `Mesorregião ${municipio.meso}`, lat: municipio.c[1], lon: municipio.c[0] },
                )
              }
            >
              <span aria-hidden="true">📅</span> Próximos 5 dias{selectedCamping ? '' : ` · ${municipio.nome}`}
            </button>
          )}
          {municipio && (
            <>
              <button className="fab" onClick={() => setCityView('ruas')}>
                <span aria-hidden="true">🏙️</span> Ruas da cidade
              </button>
              <button className="fab dark" onClick={() => setCityView('3d')}>
                <span aria-hidden="true">⛰️</span> Mapa 3D
              </button>
            </>
          )}
          <button
            className="fab route"
            onClick={() => {
              setRouteError(null)
              if (route) setRouteView(true)
              else setRouteModal(true)
            }}
          >
            <span aria-hidden="true">🧭</span> {route ? 'Ver rota' : 'Rotas'}
          </button>
        </div>
      )}

      {routeModal && (
        <RouteModal
          campings={CAMPINGS}
          initial={route ? { from: route.from, to: route.to, departure: new Date() } : null}
          defaultDestination={defaultDestination}
          onSubmit={traceRoute}
          onClose={() => setRouteModal(false)}
          busy={routeBusy}
          error={routeError}
        />
      )}

      {route && routeView && (
        <RouteMap
          route={route}
          onBack={() => setRouteView(false)}
          onClear={() => {
            setRoute(null)
            setRouteView(false)
          }}
          onEdit={() => {
            setRouteView(false)
            setRouteModal(true)
          }}
        />
      )}

      {municipio && cityView && (
        <CityMap municipio={municipio} mode={cityView} onModeChange={setCityView} onClose={() => setCityView(null)} />
      )}

      {municipio && !(current && isNarrow()) && (
        <MunicipioCard m={municipio} results={results} onSelectCamping={select} onClose={() => setMunicipio(null)} />
      )}

      <div className="legend">
        <b className="small legend-title">Laudo de risco (pior camping da região)</b>
        {RISK.map((r) => (
          <span key={r.key}><i style={{ background: r.color }} />{r.label}</span>
        ))}
        <span><i style={{ background: dark ? '#3a4757' : '#d5dce4' }} />Sem camping</span>
        {fetchedAt && <span className="muted small legend-time">Consulta: {fetchedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · atualização automática</span>}
        <button type="button" className="link-btn legend-about" onClick={() => setAbout(true)}>
          Sobre, créditos e privacidade
        </button>
      </div>
      {forecast5 && <Forecast5Modal place={forecast5} dark={dark} onClose={closeForecast5} onAbout={() => setAbout(true)} />}
      {about && <AboutModal onClose={closeAbout} />}

      {status === 'loading' && <div className="toast">Consultando 6 modelos meteorológicos…</div>}
      {error && (
        <div className="toast error">
          Não foi possível carregar o clima agora. Tente novamente em alguns minutos. <button className="link" onClick={() => load(true)}>Tentar de novo</button>
        </div>
      )}

      {panelOpen && (
        <aside ref={panelRef} className={`panel ${collapsed && !current ? 'collapsed' : ''}`}>
          {current ? (
            <Detail w={current} onClose={() => setSelected(null)} />
          ) : (
            <>
              <button
                className="panel-head"
                onClick={toggleCollapsed}
                aria-expanded={!collapsed}
                aria-controls="painel-campings"
                title={collapsed ? 'Expandir painel' : 'Recolher painel'}
              >
                <h2 className="panel-title">Campings monitorados</h2>
                {results.length > 0 && <span className="panel-count">{results.length}</span>}
                <span className={`chevron ${collapsed ? '' : 'open'}`} aria-hidden="true">
                  ▾
                </span>
              </button>
              <div id="painel-campings" className="panel-body" hidden={collapsed}>
                {results.length ? <Overview results={results} onSelect={select} query={campQuery} setQuery={setCampQuery} /> : <p className="muted">Carregando…</p>}
                <p className="muted small foot">
                  Fontes: modelos ECMWF, GFS/NOAA, ICON/DWD, UKMO, Météo-France e JMA via Open-Meteo, consolidados por mínimo, máximo, mediana e
                  concordância. Classificação operacional automática — não substitui alertas oficiais do INMET e da Defesa Civil.{' '}
                  <button type="button" className="link-btn small" onClick={() => setAbout(true)}>
                    Sobre, créditos e privacidade
                  </button>
                </p>
              </div>
            </>
          )}
        </aside>
      )}
    </div>
  )
}
