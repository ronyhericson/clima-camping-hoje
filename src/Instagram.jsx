// Link para o perfil oficial do camping no Instagram (campo `instagram` em data/campings.js).
export const igUrl = (handle) => `https://www.instagram.com/${encodeURIComponent(handle)}/`

const Glyph = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
  </svg>
)

// variant "pill": botão com @perfil (laudo); "icon": só o ícone (lista).
export default function InstagramLink({ camping, variant = 'pill' }) {
  const h = camping.instagram
  if (!h) return null
  const label = `Abrir o Instagram de ${camping.nome} (@${h})`
  return (
    <a className={`ig-link ${variant}`} href={igUrl(h)} target="_blank" rel="noopener noreferrer" aria-label={label} title={label}>
      <Glyph size={variant === 'icon' ? 18 : 16} />
      {variant === 'pill' && <span>@{h}</span>}
    </a>
  )
}
