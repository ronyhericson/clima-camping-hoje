import { useEffect, useId, useMemo, useRef, useState } from 'react'
import MUNICIPIOS from './data/sp-municipios.json'

// Busca sem acento e sem diferenciar maiúsculas ("sao jose" encontra "São José dos Campos").
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const INDEX = MUNICIPIOS.map((m) => ({ ...m, key: norm(m.nome) }))
const MAX = 8

function search(q) {
  const k = norm(q)
  if (!k) return []
  const starts = []
  const words = []
  const contains = []
  for (const m of INDEX) {
    if (m.key.startsWith(k)) starts.push(m)
    else if (m.key.split(/[\s-]+/).some((w) => w.startsWith(k))) words.push(m)
    else if (m.key.includes(k)) contains.push(m)
  }
  const byPop = (a, b) => b.pop - a.pop
  return [...starts.sort(byPop), ...words.sort(byPop), ...contains.sort(byPop)].slice(0, MAX)
}

// Destaca o trecho digitado dentro do nome.
function Highlight({ text, query }) {
  const k = norm(query)
  const i = norm(text).indexOf(k)
  if (!k || i < 0) return text
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + k.length)}</mark>
      {text.slice(i + k.length)}
    </>
  )
}

export default function MunicipioSearch({ selected, onSelect }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)
  const listId = useId()
  const results = useMemo(() => search(query), [query])

  // Se o destaque for removido por fora (ex.: ✕ do card), limpa o campo também.
  const prevSelected = useRef(selected)
  useEffect(() => {
    if (prevSelected.current && !selected) setQuery('')
    // Selecionado por fora (ex.: ao abrir um camping): mostra o nome no campo.
    else if (selected && selected.id !== prevSelected.current?.id) setQuery(selected.nome)
    prevSelected.current = selected
  }, [selected])

  const choose = (m) => {
    onSelect(m)
    setQuery(m.nome)
    setOpen(false)
    inputRef.current?.blur()
  }

  const clear = () => {
    setQuery('')
    onSelect(null)
    inputRef.current?.focus()
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((a) => Math.min(a + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      if (results[active]) {
        e.preventDefault()
        choose(results[active])
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const showList = open && query && !(selected && selected.nome === query)

  return (
    <div className="search">
      <span className="search-icon" aria-hidden="true">⌕</span>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={!!showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
        placeholder="Buscar município de SP…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        autoComplete="off"
        spellCheck="false"
      />
      {query && (
        <button className="search-clear" onClick={clear} aria-label="Limpar busca">
          ✕
        </button>
      )}
      {showList && (
        <ul className="suggestions" id={listId} role="listbox">
          {results.length ? (
            results.map((m, i) => (
              <li
                key={m.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'active' : ''}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  choose(m)
                }}
              >
                <span>
                  <Highlight text={m.nome} query={query} />
                </span>
                <span className="muted small">{m.meso}</span>
              </li>
            ))
          ) : (
            <li className="empty muted">Nenhum município encontrado</li>
          )}
        </ul>
      )}
    </div>
  )
}
