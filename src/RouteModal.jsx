import { useEffect, useId, useMemo, useRef, useState } from 'react'
import MUNICIPIOS from './data/sp-municipios.json'
import { searchAddress, currentPosition, reverseLabel } from './routing.js'

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

// Campo de lugar com sugestões: campings monitorados, municípios de SP e endereços (OpenStreetMap).
function PlacePicker({ label, value, onChange, campings, showCampingsWhenEmpty, extra, autoFocus }) {
  const [q, setQ] = useState(value?.label ?? '')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [addresses, setAddresses] = useState([])
  const [searching, setSearching] = useState(false)
  const listId = useId()
  const inputId = useId()

  useEffect(() => setQ(value?.label ?? ''), [value?.label])

  const k = norm(q)
  const typing = open && k && k !== norm(value?.label)

  // Endereços: busca com pausa de digitação para não sobrecarregar o serviço.
  useEffect(() => {
    if (!typing || k.length < 3) {
      setAddresses([])
      return
    }
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      setSearching(true)
      searchAddress(q, ctrl.signal)
        .then(setAddresses)
        .catch(() => {})
        .finally(() => setSearching(false))
    }, 400)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [k, typing])

  const options = useMemo(() => {
    const camp = campings
      .filter((c) => (typing ? [c.nome, c.municipio].some((t) => norm(t).includes(k)) : showCampingsWhenEmpty))
      .slice(0, typing ? 5 : 30)
      .map((c) => ({ title: c.nome, subtitle: `${c.municipio} · camping monitorado`, coord: [c.lon, c.lat], kind: 'camping', campingId: c.id }))
    const muni = typing
      ? MUNICIPIOS.filter((m) => norm(m.nome).startsWith(k))
          .sort((a, b) => b.pop - a.pop)
          .slice(0, 4)
          .map((m) => ({ title: m.nome, subtitle: `Município · ${m.meso}`, coord: m.c, kind: 'municipio' }))
      : []
    return [...camp, ...muni, ...(typing ? addresses : [])]
  }, [campings, k, typing, addresses, showCampingsWhenEmpty])

  const choose = (o) => {
    onChange({ label: o.title, detail: o.subtitle, coord: o.coord, campingId: o.campingId, kind: o.kind })
    setOpen(false)
  }

  const icon = { camping: '⛺', municipio: '🏙️', endereco: '📍' }

  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <div className="picker">
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          autoComplete="off"
          autoFocus={autoFocus}
          placeholder="Camping, cidade ou endereço…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setActive(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, options.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
            else if (e.key === 'Enter' && options[active]) { e.preventDefault(); choose(options[active]) }
            else if (e.key === 'Escape') setOpen(false)
          }}
        />
        {q && (
          <button type="button" className="search-clear" aria-label={`Limpar ${label.toLowerCase()}`} onClick={() => { setQ(''); onChange(null); setOpen(true) }}>
            ✕
          </button>
        )}
        {open && options.length > 0 && (
          <ul className="suggestions" id={listId} role="listbox">
            {!typing && showCampingsWhenEmpty && <li className="group muted small" aria-hidden="true">Campings monitorados</li>}
            {options.map((o, i) => (
              <li
                key={`${o.kind}-${o.title}-${i}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'active' : ''}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => { e.preventDefault(); choose(o) }}
              >
                <span className="opt">
                  <span aria-hidden="true">{icon[o.kind]}</span> {o.title}
                </span>
                <span className="muted small">{o.subtitle}</span>
              </li>
            ))}
            {searching && <li className="empty muted small">Buscando endereços…</li>}
          </ul>
        )}
      </div>
      {extra}
    </div>
  )
}

const toLocalInput = (d) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function RouteModal({ campings, initial, defaultDestination, onSubmit, onClose, busy, error }) {
  const [from, setFrom] = useState(initial?.from ?? null)
  const [to, setTo] = useState(initial?.to ?? defaultDestination ?? null)
  const [when, setWhen] = useState(() => toLocalInput(initial?.departure ?? new Date()))
  const [geo, setGeo] = useState({ state: 'idle', msg: '' })
  const dialogRef = useRef(null)

  const useMyLocation = async () => {
    setGeo({ state: 'loading', msg: 'Obtendo sua localização…' })
    try {
      const coord = await currentPosition()
      setFrom({ label: 'Minha localização', detail: 'Localização atual', coord, kind: 'gps' })
      setGeo({ state: 'ok', msg: '' })
      reverseLabel(coord).then((name) => name && setFrom((f) => (f?.kind === 'gps' ? { ...f, label: `Minha localização (${name})` } : f)))
    } catch (e) {
      setGeo({ state: 'error', msg: `${e.message}. Digite a origem.` })
    }
  }

  // Sugere a localização atual ao abrir, se ainda não houver origem.
  useEffect(() => {
    if (!from) useMyLocation()
  }, [])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const swap = () => {
    setFrom(to)
    setTo(from)
  }

  const departure = new Date(when)
  const maxDate = new Date(Date.now() + 2.5 * 86400000)
  const validWhen = !Number.isNaN(departure.getTime()) && departure <= maxDate
  const canSubmit = from?.coord && to?.coord && validWhen && !busy

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rota-titulo"
        onSubmit={(e) => {
          e.preventDefault()
          if (canSubmit) onSubmit({ from, to, departure })
        }}
      >
        <header className="modal-head">
          <h2 id="rota-titulo">Traçar rota</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </header>

        <PlacePicker
          label="Origem"
          value={from}
          onChange={(v) => {
            setFrom(v)
            if (v) setGeo({ state: 'idle', msg: '' })
          }}
          campings={campings}
          extra={
            <div className="field-extra">
              <button type="button" className="link-btn" onClick={useMyLocation} disabled={geo.state === 'loading'}>
                📍 Usar minha localização atual
              </button>
              {geo.msg && <span className={`small ${geo.state === 'error' ? 'warn' : 'muted'}`}>{geo.msg}</span>}
            </div>
          }
        />

        <button type="button" className="swap" onClick={swap} aria-label="Inverter origem e destino" title="Inverter origem e destino">
          ⇅
        </button>

        <PlacePicker label="Destino" value={to} onChange={setTo} campings={campings} showCampingsWhenEmpty autoFocus={!!from && !to} />

        <div className="field">
          <label htmlFor="rota-saida">Saída</label>
          <input id="rota-saida" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          <span className="small muted">A previsão no trajeto usa o horário estimado de passagem em cada ponto (até ~2 dias à frente).</span>
          {!validWhen && <span className="small warn">Escolha um horário dentro dos próximos 2 dias.</span>}
        </div>

        {error && <p className="form-error">{error}</p>}

        <footer className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn primary" disabled={!canSubmit}>
            {busy ? 'Traçando rota…' : 'Traçar rota'}
          </button>
        </footer>
      </form>
    </div>
  )
}
