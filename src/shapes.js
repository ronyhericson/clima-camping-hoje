// Fronteiras municipais (anéis externos, malha IBGE intermediária, a mesma do mapa base).
// Carregadas sob demanda na primeira busca e compartilhadas entre o mapa estadual e o mapa da cidade.
let shapesPromise = null
export const loadShapes = () =>
  (shapesPromise ??= import('./data/sp-municipios-fronteiras.json')
    .then((m) => m.default)
    .catch((e) => {
      shapesPromise = null // permite tentar de novo
      throw e
    }))

export function bbox(rings) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  rings.forEach((r) =>
    r.forEach(([x, y]) => {
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }),
  )
  return { x0, y0, x1, y1 }
}
