import { useEffect, useState } from 'react'
import { fetchNow, categorize, RISK, CONDITIONS, describeCode, fmt } from './weather.js'
import { iconSrc } from './icons.js'

// Card do município buscado: tempo agora, próximas horas e campings da cidade / mais próximos.

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
              <span className="muted small">{fmt(d, 0)} km · {r.line}</span>
            </span>
            <span className="dot" style={{ background: RISK[r.risk].color }} title={RISK[r.risk].label} />
          </button>
        </li>
      ))}
    </ul>
  )
}

export default function MunicipioCard({ m, results, onSelectCamping, onClose }) {
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

export const normName = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

