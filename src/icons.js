// Ícones meteorológicos em SVG (usados no mapa via "image://" e no painel).
const SUN = (cx, cy, r) => `
  <g stroke="#f5a623" stroke-width="3" stroke-linecap="round">
    ${Array.from({ length: 8 }, (_, i) => {
      const a = (i * Math.PI) / 4
      const x1 = cx + Math.cos(a) * (r + 4), y1 = cy + Math.sin(a) * (r + 4)
      const x2 = cx + Math.cos(a) * (r + 9), y2 = cy + Math.sin(a) * (r + 9)
      return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`
    }).join('')}
  </g>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffc83d" stroke="#f5a623" stroke-width="2"/>`

const MOON = (cx, cy, r) => `
  <path d="M${cx + r * 0.3} ${cy - r} a${r} ${r} 0 1 0 ${r * 0.9} ${r * 1.45} a${r * 0.8} ${r * 0.8} 0 0 1 -${r * 0.9} -${r * 1.45}z"
    fill="#f3e6a8" stroke="#c9b65c" stroke-width="2"/>`

const CLOUD = (fill = '#eef2f6', stroke = '#8a9bb0', dy = 0) => `
  <path d="M18 ${48 + dy} h30 a11 11 0 0 0 0-22 a15 15 0 0 0 -28 -4 a10 10 0 0 0 -2 26z"
    fill="${fill}" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round"/>`

const DROPS = `
  <g stroke="#2f80ed" stroke-width="3" stroke-linecap="round">
    <line x1="24" y1="50" x2="21" y2="58"/><line x1="34" y1="50" x2="31" y2="58"/><line x1="44" y1="50" x2="41" y2="58"/>
  </g>`

const BOLT = `<path d="M34 44 l-7 11 h6 l-4 9 l11 -13 h-6 l4 -7z" fill="#ffd400" stroke="#b58900" stroke-width="1.5" stroke-linejoin="round"/>`

function svg(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`
}

export function iconSvg(condition, isDay = true) {
  const sky = isDay ? SUN : MOON
  switch (condition) {
    case 'sol':
      return svg(isDay ? SUN(32, 32, 13) : MOON(30, 32, 16))
    case 'parcial':
      return svg(sky(24, 22, 10) + CLOUD('#f6f8fb', '#8a9bb0', 6))
    case 'nublado':
      return svg(`<g transform="translate(8,-8) scale(.8)">${CLOUD('#cfd8e3', '#7d8ea3')}</g>` + CLOUD('#e4eaf1', '#6f8299', 4))
    case 'chuva':
      return svg(CLOUD('#d5dee8', '#5f7590', -4) + DROPS)
    case 'tempestade':
      return svg(CLOUD('#7d8a9c', '#3e4a5c', -6) + BOLT)
    default:
      return svg(`<circle cx="32" cy="32" r="10" fill="#bbb"/>`)
  }
}

export const iconUri = (condition, isDay) =>
  'image://data:image/svg+xml;charset=utf-8,' + encodeURIComponent(iconSvg(condition, isDay))

export const iconSrc = (condition, isDay) =>
  'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(iconSvg(condition, isDay))
