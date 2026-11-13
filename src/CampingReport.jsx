import { useState } from 'react'
import { RISK, CONDITIONS, describeCode, conclusion, verdict, weekdayShort, fmt } from './weather.js'
import { iconSrc } from './icons.js'

// Laudo de um camping em 3 camadas:
//  1. veredito (o que esperar e o que fazer);
//  2. agora + linha do tempo de hoje;
//  3. detalhes técnicos (recolhidos): quadro consolidado, períodos e comparativo de fontes.

const fmtDateTime = (iso) => {
  if (!iso) return '—'
  const [d, t] = iso.split('T')
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y} ${t.slice(0, 5)}`
}
const range = (s, unit, d = 1) => (s ? (s.min === s.max ? `${fmt(s.min, d)} ${unit}` : `${fmt(s.min, d)}–${fmt(s.max, d)} ${unit}`) : 'indisponível')
const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

export function RiskTag({ level }) {
  const r = RISK[level]
  return (
    <span className="risk-tag" style={{ '--risk': r.color }}>
      <i aria-hidden="true" />
      {r.label}
    </span>
  )
}

// Intensidade da chuva por hora (mediana das fontes).
const rainLevel = (mm) => (mm == null ? 'na' : mm < 0.1 ? 'dry' : mm < 1 ? 'l1' : mm < 3 ? 'l2' : 'l3')

// Dado antigo (sem hora a hora): monta as horas a partir dos períodos do dia.
function hoursFromPeriods(periods) {
  const out = []
  periods.forEach((p) => {
    const n = p.to - p.from
    for (let h = p.from; h < p.to; h++) out.push({ h, mm: p.mm ? p.mm.median / n : null, p: p.probMax, s: p.storm >= 2 ? p.storm : 0 })
  })
  return out
}

export function DayTimeline({ w }) {
  const cur = Number(w.updatedAt?.slice(11, 13) ?? 0)
  const hours = w.hours?.length ? w.hours : hoursFromPeriods(w.periods)
  const byHour = Object.fromEntries(hours.map((h) => [h.h, h]))
  return (
    <div className="timeline">
      <ol className="tl-bar" aria-label="Chuva prevista hora a hora hoje">
        {Array.from({ length: 24 }, (_, h) => {
          const x = byHour[h]
          const lv = rainLevel(x?.mm)
          const title =
            `${h}h · ` +
            (x?.mm == null ? 'sem dado' : x.mm < 0.1 ? 'seco' : `${fmt(x.mm)} mm`) +
            (x?.p != null ? ` · chance ${x.p}%` : '') +
            (x?.s >= 2 ? ` · trovoada em ${x.s} fontes` : '')
          return (
            <li key={h} className={`tl-h ${lv} ${h < cur ? 'past' : ''} ${h === cur ? 'now' : ''}`} title={title}>
              {x?.s >= 2 && <span className="tl-storm" aria-hidden="true">⚡</span>}
            </li>
          )
        })}
      </ol>
      <div className="tl-axis muted small" aria-hidden="true">
        <span>0h</span>
        <span>6h</span>
        <span>12h</span>
        <span>18h</span>
        <span>24h</span>
      </div>
      <div className="tl-legend muted small">
        <span><i className="dry" />seco</span>
        <span><i className="l1" />fraca</span>
        <span><i className="l2" />moderada</span>
        <span><i className="l3" />forte</span>
        <span>⚡ trovoada</span>
        <span><i className="now-key" />agora</span>
      </div>
    </div>
  )
}

function WeekendBlock({ wk }) {
  return (
    <section className="wk">
      <h3>Fim de semana</h3>
      <div className="wk-days">
        {wk.days.map((d) => (
          <div key={d.date} className="wk-day" style={{ '--risk': RISK[d.risk].color }}>
            <div className="wk-top">
              <b>{weekdayShort(d.date) === 'Sáb' ? 'Sábado' : 'Domingo'}</b>
              <span className="muted small">{ddmm(d.date)}</span>
            </div>
            <div className="wk-mid">
              <img src={iconSrc(d.condition, true)} alt="" width="40" height="40" />
              <div>
                <b>{fmt(d.tMax?.median, 0)}°</b> <span className="muted">{fmt(d.tMin?.median, 0)}°</span>
                <div className="small">{(d.rain?.median ?? 0) >= 1 ? `Chuva ~${fmt(d.rain.median, 0)} mm` : 'Sem chuva relevante'}</div>
              </div>
            </div>
            <RiskTag level={d.risk} />
            {d.reasons[0] && <p className="muted small">{d.reasons[0]}</p>}
          </div>
        ))}
      </div>
    </section>
  )
}

function ShareButton({ c }) {
  const [copied, setCopied] = useState(false)
  const share = async () => {
    const url = `${window.location.origin}/#camping/${c.id}`
    const data = { title: `${c.nome} · ClimaCampingHoje`, text: `Tempo hoje no ${c.nome} (${c.municipio})`, url }
    try {
      if (navigator.share) return await navigator.share(data)
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }
  return (
    <button className="icon-btn" onClick={share} aria-label="Compartilhar link deste camping" title="Compartilhar">
      {copied ? <span className="small copied">Link copiado</span> : '↗'}
    </button>
  )
}

export default function CampingReport({ w, wk, onClose, fav, onToggleFav }) {
  const c = w.camping
  const q = encodeURIComponent(`${c.municipio} SP`)
  const v = verdict(w)
  const r = RISK[w.risk]
  // A máxima/mínima do dia nunca fica abaixo/acima do que já faz agora.
  const tMax = Math.max(w.tMax?.median ?? -99, w.now.temp ?? -99)
  const tMin = Math.min(w.tMin?.median ?? 99, w.now.temp ?? 99)
  const wetModels = w.condition === 'chuva' || w.condition === 'tempestade'
  return (
    <div className="detail">
      <header className="detail-head">
        <img src={iconSrc(w.condition, w.now.isDay)} alt="" width="52" height="52" />
        <div>
          <h2>{c.nome}</h2>
          <p className="muted small">
            {c.municipio} · {c.mesorregiao}
          </p>
        </div>
        <div className="head-actions">
          <button className={`icon-btn star ${fav ? 'on' : ''}`} onClick={onToggleFav} aria-pressed={fav} aria-label={fav ? 'Remover dos favoritos' : 'Adicionar aos favoritos'} title="Favorito">
            {fav ? '★' : '☆'}
          </button>
          <ShareButton c={c} />
          <button className="icon-btn" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
      </header>

      {wk && <WeekendBlock wk={wk} />}

      {/* Camada 1: veredito */}
      <section className="verdict" style={{ '--risk': r.color }}>
        {wk && <h3>Hoje</h3>}
        <RiskTag level={w.risk} />
        <p className="verdict-title">{v.title}.</p>
        <p className="verdict-action">{v.action}</p>
        {v.window && <p className="muted small">{v.window}</p>}
      </section>

      {/* Camada 2: agora + linha do tempo */}
      <section className="now-row">
        <div className="big">{fmt(w.now.temp, 0)}°</div>
        <div className="now-text">
          <b>{describeCode(w.now.code)} agora</b>
          <span className="muted small">
            Sensação {fmt(w.now.feels, 0)}° · máx. {fmt(tMax, 0)}° · mín. {fmt(tMin, 0)}°
          </span>
          <span className="muted small">
            Vento {fmt(w.now.wind, 0)} km/h · rajadas {fmt(w.now.gust, 0)} km/h · umidade {fmt(w.now.humidity, 0)}%
          </span>
        </div>
      </section>
      {wetModels && (w.now.precip ?? 0) < 0.2 && (
        <p className="muted small">
          {w.agreeing} de {w.sources} modelos indicam chuva nesta hora, mas ela ainda não foi registrada no local.
        </p>
      )}

      <section>
        <h3>Hoje, hora a hora</h3>
        <DayTimeline w={w} />
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

      {/* Camada 3: detalhes técnicos */}
      <details className="tech">
        <summary>Detalhes técnicos</summary>

        <p className="muted small">
          Atualização dos modelos: {fmtDateTime(w.updatedAt)} (horário de Brasília) · Confiança <b>{w.confidence}</b> · {w.agreeing} de {w.sources} fontes
          concordam (seco × chuva)
        </p>

        <section>
          <h3>Laudo completo</h3>
          <p>{conclusion(w)}</p>
          <ul className="reasons">
            {w.reasons.map((x) => (
              <li key={x}>{x}</li>
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
            <div><dt>Mín. / máx. dos modelos</dt><dd>{fmt(w.tMin?.median, 0)}° / {fmt(w.tMax?.median, 0)}°</dd></div>
            <div><dt>Rajadas máx.</dt><dd>{range(w.gust, 'km/h', 0)}</dd></div>
            <div><dt>Chuva medida agora</dt><dd>{fmt(w.now.precip)} mm</dd></div>
            <div><dt>Nuvens agora</dt><dd>{fmt(w.now.cloud, 0)}%</dd></div>
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
                <tr><th>Fonte</th><th>Nesta hora</th><th>Chuva dia</th><th>Prob.</th><th>Mín/Máx</th><th>Rajada</th></tr>
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
          <p className="muted small">Valores em destaque divergem muito da mediana. "n/d" = a fonte não publica esse dado.</p>
        </section>
      </details>

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
    </div>
  )
}
