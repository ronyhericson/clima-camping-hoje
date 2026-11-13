// MapLibre GL carregado sob demanda (mapa da cidade e mapa de rotas).
let libPromise = null
export const loadLib = () =>
  (libPromise ??= Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')])
    .then(([m]) => m.default ?? m)
    .catch((e) => {
      libPromise = null // permite tentar de novo
      throw e
    }))

export const STREET_STYLE = 'https://tiles.openfreemap.org/styles/liberty'
