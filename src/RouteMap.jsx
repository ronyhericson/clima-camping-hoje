import { useEffect, useRef, useState } from 'react'
import { loadLib, STREET_STYLE } from './maplib.js'
import { iconSrc } from './icons.js'
import { CONDITIONS, fmt } from './weather.js'
import { routeSummary } from './routing.js'

const TZ = 'America/Sao_Paulo'
const ROUTE = '#2563eb'
const hm = (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
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

export default function RouteMap({ route, onBack, onClear, onEdit }) {
  const el = useRef(null)
  const mapRef = useRef(null)
  const [status, setStatus] = useState('loading')
  const [focus, setFocus] = useState(null)
  const [sheetOpen, setSheetOpen] = useState(true)
  const arrival = new Date(route.departure.getTime() + route.duration * 1000)

  useEffect(() => {
    let cancelled = false
    let map
    const markers = []
    loadLib()
      .then((maplibregl) => {
        if (cancelled) return
        const xs = route.coords.map((c) => c[0])
        const ys = route.coords.map((c) => c[1])
        const bounds = [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]]
        const wide = el.current.clientWidth >= 900
        map = new maplibregl.Map({
          container: el.current,
          style: STREET_STYLE,
          bounds,
          fitBoundsOptions: { padding: wide ? { top: 60, bottom: 60, left: 420, right: 60 } : { top: 60, bottom: 260, left: 30, right: 30 } },
          attributionControl: { compact: true },
        })
        mapRef.current = map
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
          })
          setStatus('ready')
        })
      })
      .catch(() => !cancelled && setStatus('error'))
    return () => {
      cancelled = true
      markers.forEach((m) => m.remove())
      map?.remove()
      mapRef.current = null
    }
  }, [route])

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
      <div className="city-bar">
        <div className="city-title">
          <span className="route-dot" aria-hidden="true" />
          <div>
            <b>{route.to.label}</b>
            <span className="muted small">a partir de {route.from.label}</span>
          </div>
        </div>
        <div className="route-actions">
          <button className="btn" onClick={onEdit}>✎ Editar</button>
          <button className="btn" onClick={onClear}>🗑 Limpar rota</button>
          <button className="btn primary" onClick={onBack}>← Voltar ao mapa</button>
        </div>
      </div>
      <div ref={el} className="city-map" />

      <aside className={`route-sheet ${sheetOpen ? '' : 'closed'}`}>
        <button className="panel-head" onClick={() => setSheetOpen((o) => !o)} aria-expanded={sheetOpen}>
          <h2 className="panel-title">Clima no trajeto</h2>
          <span className={`chevron ${sheetOpen ? 'open' : ''}`} aria-hidden="true">▾</span>
        </button>
        {sheetOpen && (
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
              Previsão no horário estimado de passagem (mediana de 6 modelos · probabilidade = maior entre as fontes). Rota: OSRM / OpenStreetMap.
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
