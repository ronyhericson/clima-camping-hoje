import { useCallback, useState } from 'react'

// Favoritos ficam só neste navegador (sem cadastro).
const KEY = 'ccj:favoritos'
const read = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY)) || [])
  } catch {
    return new Set()
  }
}

export function useFavorites() {
  const [favs, setFavs] = useState(read)
  const toggle = useCallback((id) => {
    setFavs((cur) => {
      const next = new Set(cur)
      next.has(id) ? next.delete(id) : next.add(id)
      try {
        localStorage.setItem(KEY, JSON.stringify([...next]))
      } catch {}
      return next
    })
  }, [])
  return [favs, toggle]
}
