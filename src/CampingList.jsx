import { useState } from 'react'
import { RISK, CONDITIONS, fmt } from './weather.js'
import { iconSrc } from './icons.js'
import InstagramLink from './Instagram.jsx'

export const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

// `results` já vem no modo da tela (hoje ou fim de semana): risk, condition e
// `line` (frase curta) refletem o modo escolhido.
function Row({ r, onSelect, fav, onToggleFav, rank, i = 0 }) {
  return (
    <li className="row" style={{ '--i': Math.min(i, 14) }}>
      <button className="row-main" onClick={() => onSelect(r.camping.id)}>
        {rank != null && <span className="rank">{rank}º</span>}
        <img src={iconSrc(r.condition, r.now.isDay)} alt={CONDITIONS[r.condition]} width="34" height="34" />
        <span className="grow">
          <b>{r.camping.nome}</b>
          <span className="muted small">
            {r.camping.municipio} · {r.line}
          </span>
        </span>
        <span className="temp">{fmt(r.now.temp, 0)}°</span>
        <span className="dot" style={{ background: RISK[r.risk].color }} title={RISK[r.risk].label} />
      </button>
      <InstagramLink camping={r.camping} variant="icon" />
      <button className={`star ${fav ? 'on' : ''}`} onClick={() => onToggleFav(r.camping.id)} aria-pressed={fav} aria-label={fav ? `Remover ${r.camping.nome} dos favoritos` : `Favoritar ${r.camping.nome}`}>
        {fav ? '★' : '☆'}
      </button>
    </li>
  )
}

export default function CampingList({ results, mode, onSelect, query, setQuery, favs, onToggleFav }) {
  const [cond, setCond] = useState(null)
  const [region, setRegion] = useState('')
  const q = norm(query)
  const weekend = mode === 'fds'
  const regions = [...new Set(results.map((r) => r.camping.mesorregiao))].sort((a, b) => a.localeCompare(b, 'pt-BR'))

  // Busca e região primeiro; os números dos ícones contam o que sobrou.
  const base = results
    .filter((r) => !q || [r.camping.nome, r.camping.municipio, r.camping.mesorregiao].some((t) => norm(t).includes(q)))
    .filter((r) => !region || r.camping.mesorregiao === region)
  const counts = {}
  base.forEach((r) => (counts[r.condition] = (counts[r.condition] || 0) + 1))
  const filtered = base.filter((r) => !cond || r.condition === cond)
  // Hoje: os mais arriscados primeiro (alerta). Fim de semana: os melhores primeiro (ranking).
  const sorted = [...filtered].sort((a, b) =>
    weekend ? a.risk - b.risk || (a.rainSum ?? 0) - (b.rainSum ?? 0) : b.risk - a.risk || (b.rain?.median ?? 0) - (a.rain?.median ?? 0),
  )
  const favRows = sorted.filter((r) => favs.has(r.camping.id))
  const filtering = q || cond || region

  return (
    <div className="overview">
      <div className="summary-icons" role="group" aria-label="Filtrar pela condição do tempo">
        {Object.keys(CONDITIONS)
          .filter((k) => counts[k])
          .map((k) => (
            <button key={k} className={`chip ${cond === k ? 'on' : ''}`} onClick={() => setCond(cond === k ? null : k)} aria-pressed={cond === k} title={`Mostrar só: ${CONDITIONS[k]}`}>
              <img src={iconSrc(k, true)} alt={CONDITIONS[k]} width="22" height="22" /> {counts[k]}
            </button>
          ))}
      </div>
      <div className="list-filters">
        <div className="camp-search">
          <span className="search-icon" aria-hidden="true">⌕</span>
          <input
            type="search"
            placeholder="Buscar camping ou cidade…"
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
        <select className="region" value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Filtrar por região">
          <option value="">Todas as regiões</option>
          {regions.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      {filtering && (
        <p className="muted small camp-count">
          {sorted.length} de {results.length} campings{' '}
          <button
            className="link-btn small"
            onClick={() => {
              setQuery('')
              setCond(null)
              setRegion('')
            }}
          >
            Limpar filtros
          </button>
        </p>
      )}
      {filtering && !sorted.length && <p className="muted">Nenhum camping encontrado com esses filtros.</p>}

      {favRows.length > 0 && (
        <>
          <div className="list-label">★ Favoritos</div>
          <ul className="list">
            {favRows.map((r, i) => (
              <Row key={r.camping.id} i={i} r={r} onSelect={onSelect} fav onToggleFav={onToggleFav} />
            ))}
          </ul>
        </>
      )}

      <div className="list-label">{weekend ? 'Melhores para o fim de semana' : favRows.length ? 'Todos os campings' : 'Mais atenção primeiro'}</div>
      <ul className="list">
        {sorted.map((r, i) => (
          <Row key={r.camping.id} i={i + favRows.length} r={r} onSelect={onSelect} fav={favs.has(r.camping.id)} onToggleFav={onToggleFav} rank={weekend && i < 3 ? i + 1 : null} />
        ))}
      </ul>
    </div>
  )
}
