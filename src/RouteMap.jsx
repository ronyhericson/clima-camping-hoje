import { useEffect, useRef, useState } from 'react'
import { loadLib, STREET_STYLE } from './maplib.js'
import { iconSrc } from './icons.js'
import { CONDITIONS, fmt } from './weather.js'
import { routeSummary, fuelAlong } from './routing.js'

const TZ = 'America/Sao_Paulo'
const ROUTE = '#2563eb'
const hm = (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
function routeBounds(route) {
  const xs = route.coords.map((c) => c[0])
  const ys = route.coords.map((c) => c[1])
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]]
}
const dur = (s) => {
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`
}

function pointEl(p, onClick) {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = `wx-marker ${p.kind}`
  const wet = (p.mm?.median ?? 0) >= 0.3 || (p.probMax ?? 0) >= 60
  if (wet) el.classList.add('wet')
  if (p.storm >= 2) el.classList.add('storm')
  el.setAttribute(
    'aria-label',
    `${p.kind === 'origem' ? 'Origem' : p.kind === 'destino' ? 'Destino' : `Km ${Math.round(p.km)}`}, ${hm(p.eta)}: ${p.available ? CONDITIONS[p.condition] : 'sem previsão'}`,
  )
  el.innerHTML = p.available
    ? `<img src="${iconSrc(p.condition, p.isDay)}" alt="" width="30" height="30"/><span class="wx-t">${fmt(p.temp, 0)}°</span><span class="wx-h">${hm(p.eta)}</span>`
    : `<span class="wx-h">${hm(p.eta)}</span>`
  el.addEventListener('click', (e) => {
    e.stopPropagation()
    onClick(p)
  })
  return el
}

// Marcador de posto no mapa (mesmo formato dos cards de clima).
function fuelEl(s, onClick) {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = 'wx-marker fuel'
  el.setAttribute('aria-label', `Posto ${s.name}, km ${Math.round(s.km)}, passagem ~${hm(s.eta)}`)
  el.innerHTML = `<span class="fuel-ic" aria-hidden="true">⛽</span><span class="wx-h">km ${Math.round(s.km)}</span>`
  el.addEventListener('click', (e) => {
    e.stopPropagation()
    onClick(s)
  })
  return el
}

// Maior trecho sem posto (do início ao fim da rota).
function fuelSummary(stations, totalKm) {
  if (!stations.length) return `Nenhum posto encontrado a até 500 m da rota (${fmt(totalKm, 0)} km). Abasteça antes de sair.`
  const marks = [0, ...stations.map((s) => s.km), totalKm]
  let gap = { len: 0, a: 0, b: 0 }
  for (let i = 1; i < marks.length; i++) if (marks[i] - marks[i - 1] > gap.len) gap = { len: marks[i] - marks[i - 1], a: marks[i - 1], b: marks[i] }
  const n = stations.length === 1 ? '1 posto' : `${stations.length} postos`
  return `${n} a até 500 m da rota. Maior trecho sem posto: ~${fmt(gap.len, 0)} km (do km ${fmt(gap.a, 0)} ao km ${fmt(gap.b, 0)}).`
}
const mapsUrl = (s) => `https://www.google.com/maps/search/?api=1&query=${s.coord[1]},${s.coord[0]}`

export default function RouteMap({ route, onBack, onClear, onEdit }) {
  const el = useRef(null)
  const mapRef = useRef(null)
  const [status, setStatus] = useState('loading')
  const [focus, setFocus] = useState(null)
  // No celular o painel começa recolhido (só o resumo) para o mapa ficar visível.
  const [sheetOpen, setSheetOpen] = useState(() => window.innerWidth >= 900)
  const sheetRef = useRef(null)
  const [tab, setTab] = useState('clima') // 'clima' | 'postos'
  const [fuel, setFuel] = useState({ status: 'loading', stations: [] })
  const [fuelTry, setFuelTry] = useState(0)
  const fuelMarkers = useRef([])
  const wxMarkers = useRef([])
  const barRef = useRef(null)
  const arrival = new Date(route.departure.getTime() + route.duration * 1000)

  useEffect(() => {
    let cancelled = false
    let map
    let ro
    const markers = []
    loadLib()
      .then((maplibregl) => {
        if (cancelled) return
        map = new maplibregl.Map({
          container: el.current,
          style: STREET_STYLE,
          bounds: routeBounds(route),
          fitBoundsOptions: { padding: padding() },
          attributionControl: { compact: true },
        })
        mapRef.current = map
        // Celular: a barra do navegador muda a altura da tela; o mapa acompanha.
        ro = new ResizeObserver(() => map.resize())
        ro.observe(el.current)
        map.addControl(new maplibregl.NavigationControl(), 'top-right')
        map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right')
        map.on('load', () => {
          if (cancelled) return
          map.addSource('rota', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.coords } } })
          const before = map.getStyle().layers.find((l) => l.type === 'symbol')?.id
          map.addLayer({ id: 'rota-borda', type: 'line', source: 'rota', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 10 } }, before)
          map.addLayer({ id: 'rota', type: 'line', source: 'rota', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ROUTE, 'line-width': 6 } }, before)
          route.points.forEach((p) => {
            const m = new maplibregl.Marker({ element: pointEl(p, (pt) => { setFocus(pt); map.flyTo({ center: pt.coord, zoom: 12, duration: 900 }) }), anchor: 'bottom' })
              .setLngLat(p.coord)
              .addTo(map)
            markers.push(m)
            wxMarkers.current.push(m)
          })
          map.resize()
          fit(false)
          setStatus('ready')
        })
      })
      .catch((e) => {
        console.error('[Mapa de rotas]', e)
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
      ro?.disconnect()
      markers.forEach((m) => m.remove())
      wxMarkers.current = []
      map?.remove()
      mapRef.current = null
    }
  }, [route])

  // Postos no trajeto: consulta em segundo plano (não atrasa o mapa nem o clima).
  useEffect(() => {
    let alive = true
    setFuel({ status: 'loading', stations: [] })
    fuelAlong(route, route.departure)
      .then((r) => alive && setFuel({ status: 'ready', ...r }))
      .catch((e) => {
        console.error('[Postos]', e)
        if (alive) setFuel({ status: 'error', stations: [] })
      })
    return () => {
      alive = false
    }
  }, [route, fuelTry])

  // Marcadores de postos (aparecem na aba "Postos").
  useEffect(() => {
    const map = mapRef.current
    if (!map || status !== 'ready' || fuel.status !== 'ready') return
    let cancelled = false
    loadLib().then((maplibregl) => {
      if (cancelled) return
      fuelMarkers.current = fuel.stations.map((st) =>
        new maplibregl.Marker({ element: fuelEl(st, (x) => focusFuel(x)), anchor: 'bottom' }).setLngLat(st.coord).addTo(map),
      )
      showMarkers(tab)
    })
    return () => {
      cancelled = true
      fuelMarkers.current.forEach((m) => m.remove())
      fuelMarkers.current = []
    }
  }, [fuel, status])

  function showMarkers(t) {
    wxMarkers.current.forEach((m) => (m.getElement().style.display = t === 'clima' ? '' : 'none'))
    fuelMarkers.current.forEach((m) => (m.getElement().style.display = t === 'postos' ? '' : 'none'))
  }
  useEffect(() => showMarkers(tab), [tab, status])

  function focusFuel(st) {
    setTab('postos')
    setFocus(st)
    mapRef.current?.flyTo({ center: st.coord, zoom: 14, duration: 900 })
  }

  // Espaço livre do mapa: desconta o painel do trajeto (embaixo no celular, à esquerda no desktop).
  function padding() {
    const w = el.current?.clientWidth ?? 0
    const sheet = sheetRef.current?.getBoundingClientRect()
    const map = el.current?.getBoundingClientRect()
    if (w >= 900) return { top: 60, bottom: 60, left: (sheet?.width ?? 380) + 50, right: 60 }
    const covered = sheet && map ? Math.max(0, map.bottom - sheet.top) : 120
    return { top: 50, bottom: covered + 30, left: 30, right: 50 }
  }
  function fit(animate = true) {
    const map = mapRef.current
    if (!map) return
    map.fitBounds(routeBounds(route), { padding: padding(), duration: animate ? 600 : 0 })
  }
  // Reenquadra a rota quando o painel abre ou fecha.
  useEffect(() => {
    if (status === 'ready') requestAnimationFrame(() => fit())
  }, [sheetOpen, status])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onBack()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])

  const flyTo = (p) => {
    setFocus(p)
    mapRef.current?.flyTo({ center: p.coord, zoom: 12, duration: 900 })
  }

  return (
    <div className="city-overlay route-overlay" role="dialog" aria-modal="true" aria-label="Rota traçada">
      <div className="city-bar" ref={barRef}>
        <div className="city-title">
          <span className="route-dot" aria-hidden="true" />
          <div>
            <b>{route.to.label}</b>
            <span className="muted small">a partir de {route.from.label}</span>
          </div>
        </div>
        <div className="route-actions">
          <button className="btn" onClick={onEdit} aria-label="Editar rota">✎ <span className="hide-sm">Editar</span></button>
          <button className="btn" onClick={onClear} aria-label="Limpar rota">🗑 <span className="hide-sm">Limpar rota</span></button>
          <button className="btn primary" onClick={onBack}>← Voltar<span className="hide-sm"> ao mapa</span></button>
        </div>
      </div>
      <div ref={el} className="city-map" />

      <aside ref={sheetRef} className={`route-sheet ${sheetOpen ? '' : 'closed'}`}>
        <button className="panel-head" onClick={() => setSheetOpen((o) => !o)} aria-expanded={sheetOpen}>
          <h2 className="panel-title">No trajeto</h2>
          <span className="muted small route-peek-kv">
            {fmt(route.distance / 1000, 0)} km · {dur(route.duration)}
          </span>
          <span className={`chevron ${sheetOpen ? 'open' : ''}`} aria-hidden="true">▾</span>
        </button>
        <div className="seg route-tabs" role="tablist" aria-label="O que mostrar no trajeto">
          <button role="tab" aria-selected={tab === 'clima'} className={tab === 'clima' ? 'on' : ''} onClick={() => setTab('clima')}>
            🌦️ Clima
          </button>
          <button role="tab" aria-selected={tab === 'postos'} className={tab === 'postos' ? 'on' : ''} onClick={() => setTab('postos')}>
            ⛽ Postos{fuel.status === 'ready' ? ` (${fuel.stations.length})` : ''}
          </button>
        </div>
        {!sheetOpen && (
          <p className="route-peek small">
            {tab === 'clima'
              ? routeSummary(route.points)
              : fuel.status === 'ready'
                ? fuelSummary(fuel.stations, route.distance / 1000)
                : fuel.status === 'error'
                  ? 'Não foi possível buscar os postos agora; abra a lista para tentar de novo.'
                  : 'Buscando postos no trajeto…'}{' '}
            <span className="muted">Toque em “No trajeto” para ver a lista.</span>
          </p>
        )}
        {sheetOpen && tab === 'postos' && (
          <>
            {fuel.status === 'loading' && <p className="muted small">Buscando postos a até 500 m da rota…</p>}
            {fuel.status === 'error' && (
              <p className="form-error">
                O serviço de mapas que lista os postos (OpenStreetMap) não respondeu agora.{' '}
                <button className="link" onClick={() => setFuelTry((n) => n + 1)}>
                  Tentar de novo
                </button>
              </p>
            )}
            {fuel.status === 'ready' && (
              <>
                <p className="route-summary">{fuelSummary(fuel.stations, route.distance / 1000)}</p>
                <ol className="route-points">
                  {fuel.stations.map((st) => (
                    <li key={st.id} className="fuel-row">
                      <button className={focus === st ? 'on' : ''} onClick={() => focusFuel(st)}>
                        <span className="rp-time">{hm(st.eta)}</span>
                        <span className="fuel-ic" aria-hidden="true">⛽</span>
                        <span className="grow">
                          <b>{st.name}</b>
                          <span className="muted small">
                            Km {fmt(st.km, 0)} · {st.off < 120 ? 'na rota' : `${Math.round(st.off / 10) * 10} m da rota`}
                            {st.brand ? ` · ${st.brand}` : ''}
                            {st.h24 ? ' · 24 h' : ''}
                          </span>
                        </span>
                      </button>
                      <a className="fuel-go" href={mapsUrl(st)} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${st.name} no Google Maps`} title="Abrir no Google Maps">
                        ↗
                      </a>
                    </li>
                  ))}
                </ol>
                <p className="muted small">
                  Postos do OpenStreetMap a até 500 m da rota; horário = passagem estimada. Podem existir postos não mapeados ou fechados —
                  confirme antes de contar com eles. Dados © colaboradores do OpenStreetMap.
                </p>
              </>
            )}
          </>
        )}
        {sheetOpen && tab === 'clima' && (
          <>
            <dl className="kv route-kv">
              <div><dt>Distância</dt><dd>{fmt(route.distance / 1000, 0)} km</dd></div>
              <div><dt>Duração</dt><dd>{dur(route.duration)}</dd></div>
              <div><dt>Saída</dt><dd>{hm(route.departure)}</dd></div>
              <div><dt>Chegada</dt><dd>~{hm(arrival)}</dd></div>
            </dl>
            <p className="route-summary">{routeSummary(route.points)}</p>
            <ol className="route-points">
              {route.points.map((p, i) => (
                <li key={i}>
                  <button className={focus === p ? 'on' : ''} onClick={() => flyTo(p)}>
                    <span className="rp-time">{hm(p.eta)}</span>
                    {p.available ? (
                      <img src={iconSrc(p.condition, p.isDay)} alt="" width="30" height="30" />
                    ) : (
                      <span className="rp-na">—</span>
                    )}
                    <span className="grow">
                      <b>{p.kind === 'origem' ? 'Saída' : p.kind === 'destino' ? 'Chegada' : `Km ${fmt(p.km, 0)}`}</b>
                      <span className="muted small">
                        {p.available
                          ? `${CONDITIONS[p.condition]} · chuva ${p.probMax ?? '—'}%${(p.mm?.median ?? 0) >= 0.1 ? ` · ${fmt(p.mm.median)} mm` : ''}${p.storm >= 2 ? ' · trovoada' : ''}`
                          : 'Sem previsão para esse horário'}
                      </span>
                    </span>
                    {p.available && <span className="temp">{fmt(p.temp, 0)}°</span>}
                  </button>
                </li>
              ))}
            </ol>
            <p className="muted small">
              Previsão no horário estimado de passagem (mediana de 6 modelos · probabilidade = maior entre as fontes). Rota: OSRM · dados © colaboradores do OpenStreetMap.
              Tempo de viagem estimado sem trânsito.
            </p>
          </>
        )}
      </aside>

      {status === 'loading' && <div className="city-status">Carregando mapa da rota…</div>}
      {status === 'error' && <div className="city-status error">Não foi possível carregar o mapa agora.</div>}
    </div>
  )
}
