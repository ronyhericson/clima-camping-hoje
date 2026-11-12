import { useEffect, useRef, useState } from 'react'
import { loadShapes, bbox } from './shapes.js'
import { loadLib, STREET_STYLE } from './maplib.js'

// Visualização detalhada da cidade selecionada com MapLibre GL (carregado sob demanda):
//  - "ruas": mapa urbano 2D (OpenFreeMap / dados OpenStreetMap)
//  - "3d":   relevo 3D (AWS Terrain Tiles) + prédios extrudados, com câmera inclinada girando
// A fronteira municipal do IBGE é desenhada em vermelho nos dois modos.

const TERRAIN = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
const RED = '#d92d20'

function addTerrain(map) {
  if (!map.getSource('terreno')) {
    map.addSource('terreno', { type: 'raster-dem', tiles: [TERRAIN], encoding: 'terrarium', tileSize: 256, maxzoom: 15 })
  }
  if (!map.getSource('relevo')) {
    map.addSource('relevo', { type: 'raster-dem', tiles: [TERRAIN], encoding: 'terrarium', tileSize: 256, maxzoom: 15 })
  }
  if (!map.getLayer('sombreamento')) {
    const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id
    map.addLayer(
      {
        id: 'sombreamento',
        type: 'hillshade',
        source: 'relevo',
        paint: { 'hillshade-exaggeration': 0.45, 'hillshade-shadow-color': '#3d4b3a' },
      },
      firstSymbol,
    )
  }
  if (!map.getLayer('predios-3d') && !map.getLayer('building-3d')) {
    const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id
    map.addLayer(
      {
        id: 'predios-3d',
        type: 'fill-extrusion',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 13,
        paint: {
          'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, '#e7e1d8', 30, '#d6cdc0', 80, '#bfb3a3'],
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.9,
        },
      },
      firstSymbol,
    )
  }
  for (const id of ['predios-3d', 'building-3d']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible')
  map.setTerrain({ source: 'terreno', exaggeration: 1.5 })
  if (map.setSky) {
    map.setSky({ 'sky-color': '#7fb2e5', 'horizon-color': '#dbe9f6', 'fog-color': '#e6eef5', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.4 })
  }
}

// Sede do município: rótulo de cidade/vila nos próprios tiles OpenStreetMap carregados.
function findUrbanCenter(map, nome) {
  const norm = (t) => (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const alvo = norm(nome)
  const feats = map.querySourceFeatures('openmaptiles', { sourceLayer: 'place' })
  const rank = { city: 0, town: 1, village: 2 }
  const hit = feats
    .filter((f) => f.geometry?.type === 'Point' && f.properties.class in rank)
    .filter((f) => [f.properties.name, f.properties['name:pt'], f.properties.name_int].some((n) => norm(n) === alvo))
    .sort((a, b) => rank[a.properties.class] - rank[b.properties.class])[0]
  return hit ? hit.geometry.coordinates : null
}

function removeTerrain(map) {
  map.setTerrain(null)
  if (map.getLayer('predios-3d')) map.setLayoutProperty('predios-3d', 'visibility', 'none')
  if (map.getLayer('sombreamento')) map.removeLayer('sombreamento')
}

export default function CityMap({ municipio, mode, onModeChange, onClose }) {
  const el = useRef(null)
  const mapRef = useRef(null)
  const spinRef = useRef(null)
  const boundsRef = useRef(null)
  const modeRef = useRef(mode)
  const urbanRef = useRef(null)
  modeRef.current = mode
  const [status, setStatus] = useState('loading')
  const [showHint, setShowHint] = useState(true)
  const touch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  useEffect(() => {
    setShowHint(true)
    const t = setTimeout(() => setShowHint(false), 7000)
    return () => clearTimeout(t)
  }, [mode])

  // Cria o mapa uma vez por cidade.
  useEffect(() => {
    let cancelled = false
    let map
    setStatus('loading')
    Promise.all([loadLib(), loadShapes()])
      .then(([maplibregl, shapes]) => {
        if (cancelled) return
        const rings = shapes[municipio.id] ?? []
        const bb = bbox(rings)
        boundsRef.current = [[bb.x0, bb.y0], [bb.x1, bb.y1]]
        map = new maplibregl.Map({
          container: el.current,
          style: STREET_STYLE,
          bounds: boundsRef.current,
          fitBoundsOptions: { padding: 40 },
          maxPitch: 80,
          attributionControl: { compact: true },
        })
        mapRef.current = map
        map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
        map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
        map.addControl(new maplibregl.FullscreenControl(), 'top-right')

        map.on('load', () => {
          if (cancelled) return
          const data = {
            type: 'FeatureCollection',
            features: rings.map((r) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r } })),
          }
          map.addSource('fronteira', { type: 'geojson', data })
          map.addLayer({ id: 'fronteira-halo', type: 'line', source: 'fronteira', paint: { 'line-color': RED, 'line-width': 10, 'line-opacity': 0.2, 'line-blur': 2 } })
          map.addLayer({ id: 'fronteira', type: 'line', source: 'fronteira', paint: { 'line-color': RED, 'line-width': 3 }, layout: { 'line-join': 'round', 'line-cap': 'round' } })
          setStatus('ready')
        })
        map.on('error', (e) => {
          // Falha pontual de um tile não derruba o mapa; só registra.
          if (e?.error?.status !== 404) console.warn('Mapa da cidade:', e?.error?.message || e)
        })
        // Qualquer interação do usuário interrompe o giro automático do 3D.
        ;['mousedown', 'touchstart', 'wheel'].forEach((ev) => map.on(ev, () => stopSpin()))
      })
      .catch(() => !cancelled && setStatus('error'))
    return () => {
      cancelled = true
      stopSpin()
      map?.remove()
      mapRef.current = null
    }
  }, [municipio.id])

  function stopSpin() {
    if (spinRef.current) cancelAnimationFrame(spinRef.current)
    spinRef.current = null
  }

  function startSpin(map) {
    stopSpin()
    let last = performance.now()
    const step = (t) => {
      map.setBearing(map.getBearing() + (t - last) * 0.004)
      last = t
      spinRef.current = requestAnimationFrame(step)
    }
    spinRef.current = requestAnimationFrame(step)
  }

  // Alterna entre ruas (2D) e 3D.
  useEffect(() => {
    const map = mapRef.current
    if (!map || status !== 'ready') return
    stopSpin()
    if (mode === '3d') {
      addTerrain(map)
      const cam = map.cameraForBounds(boundsRef.current, { padding: 60 })
      map.flyTo({ center: cam?.center ?? map.getCenter(), zoom: Math.max((cam?.zoom ?? map.getZoom()) + 0.6, 11), pitch: 65, bearing: -20, duration: 2200, essential: true })
      map.once('moveend', () => mapRef.current === map && modeRef.current === '3d' && startSpin(map))
    } else {
      removeTerrain(map)
      map.fitBounds(boundsRef.current, { padding: 40, pitch: 0, bearing: 0, duration: 800 })
      // Depois de enquadrar o município, aproxima na área urbana (sede) para as ruas ficarem legíveis.
      map.once('idle', () => {
        if (mapRef.current !== map || modeRef.current !== 'ruas') return
        const center = urbanRef.current ?? (urbanRef.current = findUrbanCenter(map, municipio.nome))
        if (center) map.flyTo({ center, zoom: 14.3, duration: 1800, essential: true })
      })
    }
  }, [mode, status])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="city-overlay" role="dialog" aria-modal="true" aria-label={`Mapa detalhado de ${municipio.nome}`}>
      <div className="city-bar">
        <div className="city-title">
          <span className="muni-pin" aria-hidden="true" />
          <div>
            <b>{municipio.nome}</b>
            <span className="muted small">{mode === '3d' ? 'Relevo e prédios em 3D' : 'Área urbana · ruas'}</span>
          </div>
        </div>
        <div className="seg" role="tablist" aria-label="Tipo de visualização">
          <button role="tab" aria-selected={mode === 'ruas'} className={mode === 'ruas' ? 'on' : ''} onClick={() => onModeChange('ruas')}>
            🏙️ Ruas
          </button>
          <button role="tab" aria-selected={mode === '3d'} className={mode === '3d' ? 'on' : ''} onClick={() => onModeChange('3d')}>
            ⛰️ 3D
          </button>
        </div>
        <button className="btn" onClick={onClose} aria-label="Fechar mapa da cidade">
          ✕ <span className="hide-sm">Voltar ao mapa de SP</span>
        </button>
      </div>
      <div ref={el} className="city-map" />
      {status === 'loading' && <div className="city-status">Carregando mapa de {municipio.nome}…</div>}
      {status === 'error' && <div className="city-status error">Não foi possível carregar o mapa detalhado agora.</div>}
      {mode === '3d' && status === 'ready' && showHint && (
        <div className="city-hint small">
          {touch ? 'Use dois dedos para girar e inclinar' : 'Arraste com o botão direito para girar e inclinar'} · relevo exagerado 1,5×
        </div>
      )}
    </div>
  )
}
