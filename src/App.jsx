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
import CampingReport from './CampingReport.jsx'
import CampingList from './CampingList.jsx'
import MunicipioCard, { normName } from './MunicipioCard.jsx'
import { useFavorites } from './favorites.js'
import { fetchWeather, cachedFetch, RISK, outlook, weekendDates, weekendOf, weekdayShort } from './weather.js'

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
    if (!sameList) return null
    // Dados do camping (nome, Instagram…) sempre do build atual, não da cópia guardada no servidor.
    const byId = new Map(CAMPINGS.map((c) => [c.id, c]))
    const data = d.data.map((x) => ({ ...x, camping: byId.get(x.camping.id) }))
    return { ...d, data, fresh: Date.now() - d.at < SERVER_MAX_AGE }
  } catch {
    return null
  }
}

// A chave muda quando a lista de campings ou as coordenadas mudam.
const WEATHER_KEY = `ccj:clima:v2:${[...CAMPINGS.map((c) => `${c.id}@${c.lat},${c.lon}`).join('|')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7).toString(36)}`
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

const shortDate = () => {
  const s = new Date().toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'America/Sao_Paulo' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// Link direto para um camping: /#camping/<id>
const hashCamping = () => {
  const m = typeof window !== 'undefined' && window.location.hash.match(/^#camping\/([\w-]+)$/)
  return m && CAMPINGS.some((c) => c.id === m[1]) ? m[1] : null
}

// "há 12 min", atualizado a cada minuto.
function useAgo(date) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60000)
    return () => clearInterval(id)
  }, [])
  if (!date) return null
  const min = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000))
  return min < 1 ? 'agora' : min < 60 ? `há ${min} min` : `há ${Math.floor(min / 60)} h`
}

// Gesto de arrastar a aba inferior (só celular). Segue o dedo e decide no fim.
function useSheetSwipe(ref, handlers, active) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let y0 = null
    let dy = 0
    const start = (e) => {
      if (window.innerWidth >= 900) return
      // Só a partir do cabeçalho ou com a lista no topo (senão é rolagem normal).
      if (el.scrollTop > 0 && !e.target.closest('.panel-head, .detail-head')) return
      y0 = e.touches[0].clientY
      dy = 0
    }
    const move = (e) => {
      if (y0 == null) return
      dy = e.touches[0].clientY - y0
      if (dy > 0) {
        el.style.transition = 'none'
        el.style.transform = `translateY(${dy}px)`
      }
    }
    const end = () => {
      if (y0 == null) return
      el.style.transition = ''
      el.style.transform = ''
      if (dy > 80) handlers.current.down()
      else if (dy < -40) handlers.current.up()
      y0 = null
    }
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: true })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    return () => {
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
    }
  }, [active])
}

const todayLabel = () => {
  const s = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', timeZone: 'America/Sao_Paulo' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export default function App() {
  const dark = useDark()
  const [results, setResults] = useState([])
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const hasData = useRef(false)
  const [selected, setSelected] = useState(hashCamping)
  const [mode, setMode] = useState('hoje') // 'hoje' | 'fds' (fim de semana)
  const [favs, toggleFav] = useFavorites()
  // Celular: a lista fica sempre como uma aba recolhida na base da tela (padrão de apps de mapa).
  const [panelOpen, setPanelOpen] = useState(true)
  const [collapsed, setCollapsed] = useState(() => {
    if (isNarrow()) return true
    try {
      return localStorage.getItem('ccj:painelRecolhido') === '1'
    } catch {
      return false
    }
  })
  const setCollapsedTo = (v) =>
    setCollapsed((c) => {
      if (c === v) return c
      try {
        localStorage.setItem('ccj:painelRecolhido', v ? '1' : '0')
      } catch {}
      return v
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

  // Fim de semana: sábado e domingo de referência (a partir do "hoje" dos dados).
  const wkDates = useMemo(() => (results[0]?.today ? weekendDates(results[0].today) : []), [results])
  const wkMap = useMemo(() => new Map(results.map((r) => [r.camping.id, weekendOf(r, wkDates)])), [results, wkDates])
  const hasWeekend = results.length > 0 && results.every((r) => wkMap.get(r.camping.id))
  const weekend = mode === 'fds' && hasWeekend
  const wkLabel = wkDates.map((d) => `${weekdayShort(d).toLowerCase()} ${d.slice(8, 10)}`).join(' e ')
  // O que o mapa e a lista mostram, conforme o modo.
  const view = useMemo(
    () =>
      results.map((r) => {
        const wk = wkMap.get(r.camping.id)
        return weekend && wk
          ? { ...r, risk: wk.risk, condition: wk.condition, rainSum: wk.rain, now: { ...r.now, temp: wk.tMax, isDay: true }, line: wk.text }
          : { ...r, line: outlook(r) }
      }),
    [results, wkMap, weekend],
  )
  // O laudo abre sempre do início (o painel guardava a rolagem da lista).
  const panelRef = useRef(null)
  useEffect(() => {
    if (panelRef.current) panelRef.current.scrollTop = 0
  }, [selected])

  // Ao abrir um camping, destaca e enquadra o município dele (mesmo efeito da busca por município).
  // Celular: ao fechar o laudo, volta para onde estava (lista ou card do município).
  const returnTo = useRef('list')
  const select = (id) => {
    returnTo.current = isNarrow() && !panelOpen ? 'muni' : 'list'
    setSelected(id)
    history.replaceState(null, '', `#camping/${id}`)
    setPanelOpen(true)
    const c = CAMPINGS.find((x) => x.id === id)
    const key = normName(c?.municipio)
    const m = key && MUNICIPIOS.find((x) => normName(x.nome) === key)
    if (m) setMunicipio((cur) => (cur?.id === m.id ? cur : m))
  }

  const closeCamping = () => {
    setSelected(null)
    if (isNarrow() && returnTo.current === 'muni') setPanelOpen(false)
    if (window.location.hash.startsWith('#camping/')) history.replaceState(null, '', window.location.pathname + window.location.search)
  }

  // Link compartilhado (/#camping/<id>): abre o laudo e enquadra o município.
  useEffect(() => {
    const open = () => {
      const id = hashCamping()
      if (id) select(id)
      else if (window.location.hash === '#sobre') setAbout(true)
    }
    if (selected) select(selected)
    window.addEventListener('hashchange', open)
    return () => window.removeEventListener('hashchange', open)
  }, [])

  // Arrastar a aba no celular: para cima abre a lista; para baixo recolhe (ou volta do laudo para a lista).
  // Recolher a lista no celular: com município aberto, mostra o card dele no lugar.
  const collapseSheet = () => (isNarrow() && municipio ? setPanelOpen(false) : setCollapsedTo(true))
  const swipeRef = useRef({})
  swipeRef.current = {
    down: () => (current ? closeCamping() : collapseSheet()),
    up: () => !current && setCollapsedTo(false),
  }
  useSheetSwipe(panelRef, swipeRef, panelOpen)

  const ago = useAgo(fetchedAt)
  const busy = status === 'loading' || status === 'refreshing'

  return (
    <div className={`app ${panelOpen ? 'with-panel' : ''}`}>
      <MapView results={view} selectedId={selected} onSelect={select} dark={dark} municipio={municipio} route={route} />

      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true"><img src="/favicon.svg" alt="" /></span>
          <div>
            <h1>Clima<span>Camping</span>Hoje</h1>
            <p className="tagline">
              <span className="hide-sm">{todayLabel()} · o tempo nos campings de SP</span>
              <span className="show-sm">{shortDate()} · tempo nos campings de SP</span>
            </p>
          </div>
        </div>
        <MunicipioSearch
          selected={municipio}
          onSelect={(m) => {
            setMunicipio(m)
            if (m && isNarrow()) setPanelOpen(false)
            if (!m && isNarrow()) {
              setPanelOpen(true)
              setCollapsedTo(true)
            }
          }}
        />
        <div className="actions">
          <button
            className="btn status"
            onClick={() => load(true)}
            disabled={busy}
            aria-label={busy ? 'Atualizando previsões' : `Previsões atualizadas ${ago ?? ''}. Toque para atualizar`}
            title="Os dados se atualizam sozinhos a cada 30 min. Clique para buscar de novo."
          >
            <span aria-hidden="true" className={`status-dot ${busy ? 'busy' : ''}`} />
            <span>{busy ? 'Atualizando…' : ago ? <><span className="hide-sm">Atualizado </span>{ago}</> : '—'}</span>
          </button>
          <button
            className={`btn ${panelOpen ? 'active' : ''}`}
            onClick={() => {
              // Celular: o botão abre/recolhe a aba da lista (ela não some).
              if (isNarrow()) {
                if (!panelOpen || current) {
                  setPanelOpen(true)
                  if (current) closeCamping()
                  setCollapsedTo(false)
                } else setCollapsedTo(!collapsed)
                return
              }
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
          {hasWeekend && (
            <div className="seg mode" role="tablist" aria-label="Período mostrado">
              <button role="tab" aria-selected={!weekend} className={!weekend ? 'on' : ''} onClick={() => setMode('hoje')}>
                Hoje
              </button>
              <button role="tab" aria-selected={weekend} className={weekend ? 'on' : ''} onClick={() => setMode('fds')} title={`Sábado e domingo (${wkLabel})`}>
                Fim de semana
              </button>
            </div>
          )}
          {(selectedCamping || municipio) && (
            <button
              className="fab primary"
              onClick={() =>
                setForecast5(
                  selectedCamping
                    ? { kind: 'camping', nome: selectedCamping.nome, detalhe: selectedCamping.municipio, lat: selectedCamping.lat, lon: selectedCamping.lon }
                    : { kind: 'municipio', nome: municipio.nome, detalhe: `Mesorregião ${municipio.meso}`, lat: municipio.c[1], lon: municipio.c[0] },
                )
              }
            >
              <span aria-hidden="true">📅</span> Próximos 5 dias
            </button>
          )}
          {municipio && (
            <>
              <button className="fab" onClick={() => setCityView('ruas')}>
                <span aria-hidden="true">🏙️</span> Ruas
              </button>
              <button className="fab" onClick={() => setCityView('3d')}>
                <span aria-hidden="true">⛰️</span> 3D
              </button>
            </>
          )}
          <button
            className="fab"
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

      {municipio && !(isNarrow() && panelOpen) && (
        <MunicipioCard
          m={municipio}
          results={view}
          onSelectCamping={select}
          onClose={() => {
            setMunicipio(null)
            if (isNarrow()) {
              setPanelOpen(true)
              setCollapsedTo(true)
            }
          }}
        />
      )}

      <div className={`legend ${panelOpen ? 'under-sheet' : ''}`}>
        <b className="small legend-title">{weekend ? `Fim de semana (${wkLabel})` : 'Hoje'} · cor da região = camping mais crítico</b>
        {RISK.map((r) => (
          <span key={r.key}><i style={{ background: r.color }} />{r.label}</span>
        ))}
        <button type="button" className="link-btn legend-about" onClick={() => setAbout(true)}>
          Sobre e privacidade
        </button>
      </div>
      {forecast5 && <Forecast5Modal place={forecast5} dark={dark} onClose={closeForecast5} onAbout={() => setAbout(true)} />}
      {about && <AboutModal onClose={closeAbout} />}

      <div className={`topline ${busy ? 'on' : ''}`} role="progressbar" aria-hidden={!busy} aria-label="Atualizando previsões" />
      {error && (
        <div className="toast error">
          Não foi possível carregar o clima agora. Tente novamente em alguns minutos. <button className="link" onClick={() => load(true)}>Tentar de novo</button>
        </div>
      )}

      {panelOpen && (
        <aside ref={panelRef} className={`panel ${collapsed && !current ? 'collapsed' : ''} ${current ? 'is-detail' : ''}`}>
          {current ? (
            <CampingReport
              key={current.camping.id}
              w={current}
              wk={weekend ? wkMap.get(current.camping.id) : null}
              onClose={closeCamping}
              fav={favs.has(current.camping.id)}
              onToggleFav={() => toggleFav(current.camping.id)}
            />
          ) : (
            <>
              <button
                className="panel-head"
                onClick={() => (collapsed ? setCollapsedTo(false) : collapseSheet())}
                aria-expanded={!collapsed}
                aria-controls="painel-campings"
                title={collapsed ? 'Expandir painel' : 'Recolher painel'}
              >
                <h2 className="panel-title">{weekend ? `Fim de semana · ${wkLabel}` : 'Campings monitorados'}</h2>
                {results.length > 0 && <span className="panel-count">{results.length}</span>}
                <span className="mini-legend show-sm" aria-hidden="true">
                  {RISK.map((r) => (
                    <i key={r.key} style={{ background: r.color }} title={r.label} />
                  ))}
                </span>
                <span className={`chevron ${collapsed ? '' : 'open'}`} aria-hidden="true">
                  ▾
                </span>
              </button>
              <div id="painel-campings" className="panel-body" hidden={collapsed}>
                {results.length ? (
                  <CampingList
                    key={weekend ? 'fds' : 'hoje'}
                    results={view} mode={weekend ? 'fds' : 'hoje'} onSelect={select} query={campQuery} setQuery={setCampQuery} favs={favs} onToggleFav={toggleFav} />
                ) : (
                  <ul className="list skeleton" aria-label="Carregando campings">
                    {Array.from({ length: 7 }, (_, i) => (
                      <li key={i} style={{ '--i': i }}>
                        <i className="sk-ic" />
                        <span className="grow">
                          <i className="sk-line" />
                          <i className="sk-line short" />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="muted small foot">
                  Mediana de 6 modelos meteorológicos (ECMWF, GFS, ICON, UKMO, Météo-France e JMA). Classificação automática — não substitui os
                  alertas oficiais do INMET e da Defesa Civil.{' '}
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
