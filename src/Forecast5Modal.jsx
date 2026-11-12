import { useEffect, useRef, useState } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { fetchForecast5 } from './forecast5.js'
import { RISK, CONDITIONS, fmt } from './weather.js'
import { iconSrc } from './icons.js'

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

const TZ = 'America/Sao_Paulo'
const todayBR = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
const asDate = (iso) => new Date(`${iso}T12:00:00-03:00`)
function dayName(iso, i) {
  if (iso === todayBR()) return 'Hoje'
  if (i === 1 && asDate(iso) - asDate(todayBR()) === 86400000) return 'Amanhã'
  const w = asDate(iso).toLocaleDateString('pt-BR', { weekday: 'long', timeZone: TZ })
  return w.charAt(0).toUpperCase() + w.slice(1).replace('-feira', '')
}
const shortDate = (iso) => asDate(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: TZ })

function Chart({ days, dark }) {
  const el = useRef(null)
  useEffect(() => {
    const chart = echarts.init(el.current, null, { renderer: 'canvas' })
    const text = dark ? '#a3b1c2' : '#566577'
    const grid = dark ? '#243243' : '#e5eaf0'
    chart.setOption({
      animationDuration: 500,
      grid: { left: 34, right: 44, top: 34, bottom: 24 },
      legend: { top: 0, left: 'center', itemWidth: 12, itemHeight: 8, textStyle: { color: text, fontSize: 11 } },
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: dark ? '#14212e' : '#fff',
        borderColor: dark ? '#2a3a4c' : '#dde3ea',
        textStyle: { color: dark ? '#e6edf5' : '#1b2a3a', fontSize: 12 },
        valueFormatter: (v) => (v == null ? '—' : fmt(v)),
      },
      xAxis: {
        type: 'category',
        data: days.map((d, i) => { const n = dayName(d.date, i); return n === 'Hoje' || n === 'Amanhã' ? n : n.slice(0, 3) }),
        axisLine: { lineStyle: { color: grid } },
        axisTick: { show: false },
        axisLabel: { color: text, fontSize: 11, interval: 0 },
      },
      yAxis: [
        { type: 'value', min: (v) => Math.floor(v.min - 4), max: (v) => Math.ceil(v.max + 2), splitNumber: 4, splitLine: { lineStyle: { color: grid } }, axisLabel: { color: text, fontSize: 10, formatter: '{value}°' } },
        { type: 'value', min: 0, max: (v) => Math.max(10, Math.ceil(v.max * 1.6)), splitNumber: 4, splitLine: { show: false }, axisLabel: { color: text, fontSize: 10, formatter: '{value} mm' } },
      ],
      series: [
        {
          name: 'Chuva (mm)', type: 'bar', yAxisIndex: 1, barWidth: '38%',
          itemStyle: { color: '#3b82f6', opacity: 0.55, borderRadius: [4, 4, 0, 0] },
          data: days.map((d) => d.rain?.median ?? null),
        },
        {
          name: 'Máx.', type: 'line', smooth: true, symbolSize: 6, itemStyle: { color: '#ea580c' },
          label: { show: true, color: '#ea580c', fontSize: 10, formatter: (p) => `${Math.round(p.value)}°` },
          data: days.map((d) => d.tMax?.median ?? null),
        },
        {
          name: 'Mín.', type: 'line', smooth: true, symbolSize: 6, itemStyle: { color: '#0ea5e9' },
          label: { show: true, position: 'bottom', color: '#0ea5e9', fontSize: 10, formatter: (p) => `${Math.round(p.value)}°` },
          data: days.map((d) => d.tMin?.median ?? null),
        },
      ],
    })
    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(el.current)
    return () => {
      ro.disconnect()
      chart.dispose()
    }
  }, [days, dark])
  return <div ref={el} className="f5-chart" role="img" aria-label="Gráfico de temperatura máxima, mínima e chuva nos próximos 5 dias" />
}

export default function Forecast5Modal({ place, dark, onClose, onAbout }) {
  const [state, setState] = useState({ status: 'loading' })
  const [open, setOpen] = useState(0)

  useEffect(() => {
    let alive = true
    setState({ status: 'loading' })
    fetchForecast5(place.lat, place.lon)
      .then((data) => alive && setState({ status: 'ready', data }))
      .catch((e) => alive && setState({ status: 'error', error: e.message || String(e) }))
    return () => {
      alive = false
    }
  }, [place.lat, place.lon])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const data = state.data
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal f5" role="dialog" aria-modal="true" aria-labelledby="f5-titulo">
        <header className="modal-head">
          <div>
            <h2 id="f5-titulo">Próximos 5 dias</h2>
            <div className="muted small">
              {place.kind === 'camping' ? '⛺' : '🏙️'} <b>{place.nome}</b>
              {place.detalhe ? ` · ${place.detalhe}` : ''}
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar" autoFocus>
            ✕
          </button>
        </header>

        {state.status === 'loading' && <p className="muted f5-wait">Consultando 6 modelos meteorológicos…</p>}
        {state.status === 'error' && (
          <p className="form-error">Não foi possível consultar a previsão agora: {state.error}. Nenhum dado foi simulado.</p>
        )}

        {data && (
          <>
            {(data.aviso || data.stale) && (
              <p className="small warn">
                ⚠ {data.aviso ?? `${data.stale}. Mostrando a consulta das ${new Date(data.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}.
              </p>
            )}
            <Chart days={data.days} dark={dark} />

            <ol className="f5-days">
              {data.days.map((d, i) => {
                const r = RISK[d.risk]
                const expanded = open === i
                return (
                  <li key={d.date} className={expanded ? 'open' : ''}>
                    <button type="button" className="f5-row" aria-expanded={expanded} onClick={() => setOpen(expanded ? -1 : i)}>
                      <span className="f5-day">
                        <b>{dayName(d.date, i)}</b>
                        <span className="muted small">{shortDate(d.date)}</span>
                      </span>
                      <img src={iconSrc(d.condition, true)} alt="" width="34" height="34" />
                      <span className="f5-cond">
                        {CONDITIONS[d.condition]}
                        <span className="muted small">
                          {d.rain?.median >= 0.1 ? `${fmt(d.rain.median)} mm` : 'sem chuva'}
                          {d.prob?.median != null ? ` · ${Math.round(d.prob.median)}%` : ''}
                        </span>
                      </span>
                      <span className="f5-temp">
                        <b>{fmt(d.tMax?.median, 0)}°</b>
                        <span className="muted">{fmt(d.tMin?.median, 0)}°</span>
                      </span>
                      <i className="f5-risk" style={{ background: r.color }} title={r.label} />
                    </button>

                    {expanded && (
                      <div className="f5-detail">
                        <div className="f5-periods">
                          {d.periods.map((p) => (
                            <div key={p.key} className="f5-period">
                              <span className="muted small">{p.label}</span>
                              {p.condition ? (
                                <img src={iconSrc(p.condition, !p.night)} alt={CONDITIONS[p.condition]} title={CONDITIONS[p.condition]} width="30" height="30" />
                              ) : (
                                <span className="muted">—</span>
                              )}
                              <span className="small">{p.mm?.median >= 0.1 ? `${fmt(p.mm.median)} mm` : p.condition ? 'seco' : ''}</span>
                            </div>
                          ))}
                        </div>
                        <dl className="kv">
                          <div><dt>Chuva (faixa)</dt><dd>{d.rain ? `${fmt(d.rain.min)}–${fmt(d.rain.max)} mm` : '—'}</dd></div>
                          <div><dt>Máx. / mín.</dt><dd>{d.tMax ? `${fmt(d.tMax.min, 0)}–${fmt(d.tMax.max, 0)}° / ${fmt(d.tMin.min, 0)}–${fmt(d.tMin.max, 0)}°` : '—'}</dd></div>
                          <div><dt>Rajada</dt><dd>{d.gust ? `${fmt(d.gust.median, 0)} km/h` : 'n/d'}</dd></div>
                          <div><dt>Fontes</dt><dd>{d.agree} de {d.sources} concordam</dd></div>
                        </dl>
                        <p className="small">
                          <b style={{ color: r.color }}>{r.label}</b> · {d.reasons.length ? d.reasons.join('; ') : 'Sem indicação de tempestade, chuva volumosa ou vento perigoso'}
                        </p>
                      </div>
                    )}
                  </li>
                )
              })}
            </ol>

            <p className="muted small">
              Mediana de {data.models.length > 1 ? `${data.models.length} modelos (${data.models.join(', ')})` : data.models[0]} · % = chance de chuva
              (mediana das fontes). Quanto mais distante o dia, menor a precisão. Não substitui alertas oficiais.{' '}
              {onAbout && (
                <button type="button" className="link-btn small" onClick={onAbout}>
                  Créditos
                </button>
              )}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
