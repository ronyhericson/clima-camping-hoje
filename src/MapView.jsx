import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { MapChart, ScatterChart, EffectScatterChart, LinesChart } from 'echarts/charts'
import { GeoComponent, TooltipComponent, VisualMapComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import spGeo from './data/sp-mesorregioes.geo.json'
// [nome, lon, lat, população] — centro de cada um dos 645 municípios (malha IBGE),
// ordenado por população (estimativa IBGE). Com o mapa inteiro aparecem só as
// maiores cidades; ao dar zoom, as demais vão sendo reveladas.
import cityCenters from './data/sp-municipios-centros.json'

const CITIES = cityCenters.map(([name, lon, lat, pop]) => ({
  name,
  value: [lon, lat],
  label: pop >= 500000 ? { fontWeight: 700, fontSize: 11 } : undefined,
}))
// Poucos nomes no mapa inteiro (só as maiores cidades) e nenhum colado num
// camping: o ícone do camping é a informação principal. Com zoom, aparecem mais.
const CAMP_PTS = CAMPINGS.map((c) => [c.lon, c.lat])
const nearCamp = ([lon, lat], d) => CAMP_PTS.some(([x, y]) => Math.abs(x - lon) < d && Math.abs(y - lat) < d * 0.8)
const citiesForZoom = (zoom, exclude) =>
  CITIES.slice(0, Math.min(CITIES.length, Math.round(12 * zoom * zoom))).filter((c) => c.name !== exclude && !nearCamp(c.value, 0.38 / zoom))
import { RISK, CONDITIONS, fmt } from './weather.js'
import { CAMPINGS } from './data/campings.js'
import { iconUri } from './icons.js'
import { loadShapes, bbox } from './shapes.js'

// Extensão do estado, usada para calcular o zoom que enquadra o município.
const SP_W = 8.95
const SP_H = 5.53
const SP_CENTER = [-48.63, -22.55]

const RED = '#d92d20'

echarts.use([MapChart, ScatterChart, EffectScatterChart, LinesChart, GeoComponent, TooltipComponent, VisualMapComponent, CanvasRenderer])
echarts.registerMap('SP', spGeo)

// Fundo neutro; a região recebe só um tom suave da cor de risco.
// A cor forte fica no marcador de cada camping (a informação real).
const BASE_LIGHT = '#e9eef3'
const BASE_DARK = '#1f2a36'
function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const [x, y] = [p(a), p(b)]
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`
}
const textOn = (risk) => (risk === 1 ? '#1b2a3a' : '#fff')

function regionData(results) {
  const worst = {}
  results.forEach((r) => {
    const k = r.camping.mesorregiao
    worst[k] = Math.max(worst[k] ?? -1, r.risk)
  })
  return spGeo.features.map((f) => ({ name: f.properties.name, value: worst[f.properties.name] ?? -1 }))
}

function borderSeries(b, dark) {
  const rings = b?.rings ?? []
  return [
    {
      // Halo largo e translúcido para o contorno "brilhar".
      id: 'fronteira-halo',
      type: 'lines',
      coordinateSystem: 'geo',
      polyline: true,
      silent: true,
      z: 6,
      data: rings.map((coords) => ({ coords })),
      lineStyle: { color: RED, width: 9, opacity: 0.22, cap: 'round', join: 'round' },
    },
    {
      // Contorno vermelho com um ponto de luz percorrendo a fronteira.
      id: 'fronteira',
      type: 'lines',
      coordinateSystem: 'geo',
      polyline: true,
      silent: true,
      z: 7,
      data: rings.map((coords) => ({ coords })),
      lineStyle: { color: RED, width: 2.6, opacity: 1, cap: 'round', join: 'round' },
      effect: { show: rings.length > 0, period: 5, trailLength: 0.35, symbolSize: 5, color: '#fff' },
    },
    {
      id: 'fronteira-nome',
      type: 'scatter',
      coordinateSystem: 'geo',
      silent: true,
      z: 8,
      symbolSize: 0,
      data: b ? [{ name: b.nome, value: b.c }] : [],
      label: {
        show: true,
        formatter: '{b}',
        fontSize: 15,
        fontWeight: 800,
        color: RED,
        textBorderColor: dark ? '#0d1620' : '#fff',
        textBorderWidth: 4,
      },
    },
  ]
}

// Rota traçada desenhada no mapa estadual (linha azul com contorno branco).
function routeSeries(route) {
  const coords = route ? route.coords.filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 800)) === 0 || i === a.length - 1) : []
  const data = route ? [{ coords }] : []
  return [
    { id: 'rota-borda', type: 'lines', coordinateSystem: 'geo', polyline: true, silent: true, z: 4, data, lineStyle: { color: '#ffffff', width: 6, opacity: 1, cap: 'round', join: 'round' } },
    { id: 'rota', type: 'lines', coordinateSystem: 'geo', polyline: true, silent: true, z: 4, data, lineStyle: { color: '#2563eb', width: 3.5, opacity: 1, cap: 'round', join: 'round' } },
  ]
}

// Campings que ficariam um em cima do outro na tela viram um único ícone com a
// quantidade. O ícone do grupo é o do camping de pior laudo (o clima mais
// relevante da região). Com zoom suficiente, cada um aparece no seu endereço;
// se dois tiverem o mesmo ponto, ficam lado a lado em volta dele.
function clusterPoints(chart, points, radius, selectedId, zoom, cityName) {
  const px = (p) => {
    try {
      return chart.convertToPixel({ geoIndex: 0 }, p.value.slice(0, 2))
    } catch {
      return null
    }
  }
  const items = points.map((p) => ({ p, xy: px(p) }))
  if (items.some((i) => !i.xy)) return { singles: points, groups: [] }
  const order = [...items].sort((a, b) => b.p.r.risk - a.p.r.risk)
  const used = new Set()
  const singles = []
  const groups = []
  for (const a of order) {
    if (used.has(a)) continue
    used.add(a)
    if (a.p.id === selectedId) {
      singles.push(a.p)
      continue
    }
    const members = [a]
    for (const b of order) {
      if (used.has(b) || b.p.id === selectedId) continue
      if (Math.hypot(a.xy[0] - b.xy[0], a.xy[1] - b.xy[1]) < radius) {
        used.add(b)
        members.push(b)
      }
    }
    if (members.length === 1) singles.push(a.p)
    else if (zoom >= 12 || (cityName && members.every((m) => m.p.r.camping.municipio === cityName))) {
      // Zoom de cidade (ou o município buscado): cada camping aparece separado,
      // lado a lado em volta do ponto comum, em vez de virar um grupo.
      members.forEach((m, k) => {
        const ang = (2 * Math.PI * k) / members.length - Math.PI / 2
        singles.push({ ...m.p, symbolOffset: [Math.cos(ang) * radius * 0.7, Math.sin(ang) * radius * 0.7] })
      })
    } else {
      const ps = members.map((m) => m.p)
      const lon = ps.reduce((t, p) => t + p.value[0], 0) / ps.length
      const lat = ps.reduce((t, p) => t + p.value[1], 0) / ps.length
      groups.push({ ...a.p, id: undefined, name: `${ps.length} campings`, value: [lon, lat, a.p.value[2]], members: ps })
    }
  }
  return { singles, groups }
}

export default function MapView({ results, selectedId, onSelect, dark, municipio, route }) {
  const borderRef = useRef(null)
  const darkRef = useRef(dark)
  darkRef.current = dark
  const el = useRef(null)
  const chart = useRef(null)
  const selectRef = useRef(onSelect)
  const zoomRef = useRef(1)
  const pointsRef = useRef({ points: [], radius: 30, selectedId: null, narrow: false })
  selectRef.current = onSelect

  // Recalcula os grupos de campings conforme o zoom atual do mapa.
  const campingSeries = () => {
    const c = chart.current
    const { points, radius, selectedId, narrow } = pointsRef.current
    const zoom = c.getOption()?.geo?.[0]?.zoom ?? 1
    const { singles, groups } = clusterPoints(c, points, radius, selectedId, zoom, borderRef.current?.nome)
    const size = narrow ? 32 : 46
    const halo = (p, s) => ({ value: p.value, symbolSize: s, symbolOffset: p.symbolOffset, itemStyle: { color: RISK[p.r.risk].color } })
    return [
      { id: 'campings', data: singles },
      {
        id: 'campings-risco',
        data: [
          ...singles.map((p) => halo(p, p.symbolSize * 0.95)),
          ...groups.map((g) => halo(g, size * 0.95)),
        ],
      },
      {
        id: 'campings-grupo',
        data: groups.map((g) => ({ ...g, symbolSize: size })),
      },
      {
        id: 'campings-qtd',
        data: groups.map((g) => ({
          value: g.value, name: g.name, n: g.members.length, members: g.members, group: true,
          itemStyle: { color: RISK[g.r.risk].color }, label: { color: textOn(g.r.risk) },
        })),
      },
    ]
  }
  const refreshCampings = () => chart.current && chart.current.setOption({ series: campingSeries() })

  useEffect(() => {
    chart.current = echarts.init(el.current, null, { renderer: 'canvas' })
    chart.current.on('click', (p) => {
      if (p.data?.id) return selectRef.current(p.data.id)
      // Grupo de campings: aproxima até eles se separarem.
      const members = p.data?.members
      if (!members) return
      const xs = members.map((m) => m.value[0])
      const ys = members.map((m) => m.value[1])
      const w = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 0.002)
      const cur = chart.current.getOption().geo?.[0]?.zoom ?? 1
      const zoom = Math.min(40, Math.max(cur * 2.5, (SP_W / w) * 0.12))
      zoomRef.current = zoom
      chart.current.setOption({
        geo: { center: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2], zoom },
        series: [{ id: 'cidades', data: citiesForZoom(zoom, borderRef.current?.nome) }],
      })
      refreshCampings()
    })
    chart.current.on('georoam', () => {
      const zoom = chart.current.getOption().geo?.[0]?.zoom ?? 1
      if (Math.abs(zoom - zoomRef.current) < 0.05) return
      zoomRef.current = zoom
      chart.current.setOption({ series: [{ id: 'cidades', data: citiesForZoom(zoom, borderRef.current?.nome) }, ...campingSeries()] })
    })
    const ro = new ResizeObserver(() => chart.current?.resize())
    ro.observe(el.current)
    return () => {
      ro.disconnect()
      chart.current.dispose()
    }
  }, [])

  useEffect(() => {
    if (!chart.current) return
    const narrow = el.current.clientWidth < 700
    const text = dark ? '#e6edf5' : '#1b2a3a'
    const border = dark ? '#111821' : '#ffffff'

    const points = results.map((r) => ({
      id: r.camping.id,
      name: r.camping.nome,
      value: [r.camping.lon, r.camping.lat, r.now.temp],
      symbol: iconUri(r.condition, r.now.isDay),
      symbolSize: r.camping.id === selectedId ? (narrow ? 40 : 56) : narrow ? 28 : 42,
      r,
    }))
    const alerts = points.filter((p) => p.r.condition === 'tempestade' || p.r.risk >= 2)

    chart.current.setOption(
      {
        backgroundColor: 'transparent',
        tooltip: {
          trigger: 'item',
          confine: true,
          backgroundColor: dark ? '#14212e' : '#fff',
          borderColor: dark ? '#2a3a4c' : '#dde3ea',
          textStyle: { color: text },
          formatter: (p) => {
            if (p.seriesType === 'map') {
              const v = p.value
              return `<b>${p.name}</b><br/>${v >= 0 ? `Camping mais crítico: <b style="color:${RISK[v].color}">${RISK[v].label}</b>` : 'Sem camping monitorado'}`
            }
            const members = p.data.members
            if (members) {
              return `<b>${members.length} campings aqui</b><br/>` +
                members
                  .map((m) => `<span style="color:${RISK[m.r.risk].color}">●</span> ${m.r.camping.nome} · ${m.r.line ?? CONDITIONS[m.r.condition]}`)
                  .join('<br/>') +
                `<br/><span style="opacity:.7">Clique para aproximar</span>`
            }
            const r = p.data.r
            if (!r) return ''
            return `<b>${r.camping.nome}</b><br/>${r.camping.municipio}<br/>
              ${r.line ?? CONDITIONS[r.condition]} · <b>${fmt(r.now.temp, 0)}°</b><br/>
              <b style="color:${RISK[r.risk].color}">${RISK[r.risk].label}</b><br/>
              <span style="opacity:.7">Clique para o laudo completo</span>`
          },
        },
        visualMap: {
          type: 'piecewise',
          seriesIndex: 0,
          show: false,
          pieces: [
            { value: -1, color: dark ? BASE_DARK : BASE_LIGHT },
            ...RISK.map((r, i) => ({ value: i, color: mix(dark ? BASE_DARK : BASE_LIGHT, r.color, dark ? 0.24 : 0.22) })),
          ],
        },
        animationDurationUpdate: 800,
        animationEasingUpdate: 'cubicInOut',
        geo: {
          map: 'SP',
          roam: true,
          scaleLimit: { min: 0.8, max: 40 },
          layoutCenter: narrow ? ['50%', '50%'] : ['46%', '52%'],
          layoutSize: narrow ? '96%' : '92%',
          itemStyle: { borderColor: dark ? '#3b4a5b' : '#c3ced9', borderWidth: 1, opacity: 1 },
          emphasis: { label: { show: false }, itemStyle: { areaColor: null, borderWidth: 2, borderColor: text, opacity: 1 } },
          select: { disabled: true },
          label: { show: false },
        },
        series: [
          {
            type: 'map',
            geoIndex: 0,
            data: regionData(results),
            itemStyle: { opacity: 1 },
          },
          {
            // Nome de cada município no seu centro. hideOverlap esconde os que
            // colidem; ao dar zoom, mais nomes aparecem.
            id: 'cidades',
            name: 'cidades',
            type: 'scatter',
            coordinateSystem: 'geo',
            data: citiesForZoom(zoomRef.current, borderRef.current?.nome),
            symbol: 'circle',
            symbolSize: 3,
            itemStyle: { color: dark ? 'rgba(237,242,247,.6)' : 'rgba(22,33,45,.5)' },
            silent: true,
            tooltip: { show: false },
            z: 2,
            label: {
              show: true,
              position: 'top',
              distance: 2,
              formatter: '{b}',
              fontSize: narrow ? 9 : 10,
              color: dark ? '#e2e8f0' : '#1f2b38',
              textBorderColor: dark ? 'rgba(17,24,33,.9)' : 'rgba(255,255,255,.95)',
              textBorderWidth: 2,
            },
            labelLayout: { hideOverlap: true },
          },
          {
            type: 'effectScatter',
            coordinateSystem: 'geo',
            data: alerts.map((p) => ({ ...p, symbol: 'circle', symbolSize: narrow ? 12 : 18 })),
            rippleEffect: { scale: 3.2, brushType: 'stroke' },
            itemStyle: { color: (p) => RISK[p.data.r.risk].color },
            silent: true,
            z: 3,
          },
          ...routeSeries(route),
          ...borderSeries(borderRef.current, dark),
          {
            // Disco na cor do laudo atrás de cada ícone de camping.
            id: 'campings-risco',
            type: 'scatter',
            coordinateSystem: 'geo',
            data: [],
            symbol: 'circle',
            silent: true,
            z: 4,
            itemStyle: { opacity: dark ? 0.55 : 0.4, borderColor: border, borderWidth: 1.5 },
          },
          {
            id: 'campings',
            type: 'scatter',
            coordinateSystem: 'geo',
            data: points,
            z: 5,
            label: {
              show: !narrow,
              position: 'bottom',
              distance: 2,
              formatter: (p) => `${fmt(p.data.r.now.temp, 0)}°`,
              color: text,
              fontWeight: 700,
              fontSize: 12,
              textBorderColor: dark ? '#0d1620' : '#fff',
              textBorderWidth: 3,
            },
            emphasis: { scale: 1.25 },
          },
          {
            // Vários campings no mesmo lugar da tela: um ícone (clima do pior laudo)…
            id: 'campings-grupo',
            type: 'scatter',
            coordinateSystem: 'geo',
            data: [],
            z: 5,
            label: {
              show: !narrow,
              position: 'bottom',
              distance: 2,
              formatter: (p) => `${fmt(p.data.r.now.temp, 0)}°`,
              color: text,
              fontWeight: 700,
              fontSize: 12,
              textBorderColor: dark ? '#0d1620' : '#fff',
              textBorderWidth: 3,
            },
            emphasis: { scale: 1.15 },
          },
          {
            // …com um selo da quantidade no canto.
            id: 'campings-qtd',
            type: 'scatter',
            coordinateSystem: 'geo',
            data: [],
            z: 6,
            symbol: 'circle',
            symbolSize: narrow ? 17 : 20,
            symbolOffset: narrow ? [13, -13] : [18, -18],
            itemStyle: { color: RED, borderColor: border, borderWidth: 2 },
            label: {
              show: true,
              position: 'inside',
              formatter: (p) => p.data.n,
              color: '#fff',
              fontWeight: 800,
              fontSize: narrow ? 10 : 11,
            },
          },
        ],
      },
      { replaceMerge: ['series'] },
    )
    pointsRef.current = { points, radius: narrow ? 26 : 38, selectedId, narrow }
    refreshCampings()
  }, [results, selectedId, dark, route])

  // Município buscado: contorno vermelho + voo animado até ele.
  useEffect(() => {
    if (!chart.current) return
    let cancelled = false
    const apply = (b, center, zoom) => {
      borderRef.current = b
      zoomRef.current = zoom
      chart.current.setOption({
        geo: { center, zoom },
        series: [...borderSeries(b, darkRef.current), { id: 'cidades', data: citiesForZoom(zoom, b?.nome) }],
      })
      refreshCampings()
    }
    if (!municipio) {
      if (borderRef.current) apply(null, SP_CENTER, 1)
      return
    }
    loadShapes().then((shapes) => {
      if (cancelled) return
      const rings = shapes[municipio.id] ?? []
      const bb = bbox(rings)
      const w = Math.max(bb.x1 - bb.x0, 0.05)
      const h = Math.max(bb.y1 - bb.y0, 0.05)
      const narrow = el.current.clientWidth < 900
      // No celular, com o laudo do camping aberto (painel mais alto), sobra uma faixa menor de mapa.
      const sheet = narrow && selectedId
      let zoom = Math.min(12, Math.max(1.6, Math.min(SP_W / w, SP_H / h) * (sheet ? 0.2 : narrow ? 0.3 : 0.38)))
      // Campings do município: aproxima um pouco mais (até 1,6×) para que fiquem separados nos seus endereços.
      const own = pointsRef.current.points.filter((p) => p.r.camping.municipio === municipio.nome).map((p) => p.value)
      let minD = Infinity
      for (let a = 0; a < own.length; a++)
        for (let b = a + 1; b < own.length; b++) minD = Math.min(minD, Math.hypot(own[a][0] - own[b][0], own[a][1] - own[b][1]))
      if (Number.isFinite(minD) && minD > 0.002) {
        const pxPerDeg1 = (el.current.clientWidth * (narrow ? 0.96 : 0.92)) / SP_W
        const need = (pointsRef.current.radius * 1.3) / (minD * pxPerDeg1)
        if (need > zoom) zoom = Math.min(40, need, zoom * 1.6)
      }
      const center = [(bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2]
      if (narrow) {
        // No celular o card ocupa a parte de baixo: desloca o município para a área visível do mapa.
        const pxPerDeg = ((el.current.clientWidth * 0.96) / SP_W) * zoom
        center[1] -= (el.current.clientHeight * (sheet ? 0.15 : 0.1)) / pxPerDeg
      }
      apply({ rings, nome: municipio.nome, c: municipio.c }, center, zoom)
    })
    return () => {
      cancelled = true
    }
  }, [municipio, selectedId])

  return <div ref={el} className="map" role="img" aria-label="Mapa do estado de São Paulo com o tempo agora nos campings" />
}
