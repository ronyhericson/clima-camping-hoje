import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

// Depois de um deploy novo, uma aba aberta antes dele ainda pede os arquivos
// antigos (mapa de ruas, 3D, rotas), que já não existem. Recarrega a página uma
// vez para pegar a versão nova, em vez de mostrar erro.
window.addEventListener('vite:preloadError', (e) => {
  const KEY = 'ccj:reload-after-deploy'
  let last = 0
  try {
    last = Number(sessionStorage.getItem(KEY)) || 0
  } catch {}
  if (Date.now() - last < 60_000) return // já tentou há pouco: deixa o erro aparecer
  e.preventDefault()
  console.warn('[App] Arquivo de uma versão anterior do site; recarregando.', e.payload)
  try {
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {}
  window.location.reload()
})

// App instalável (PWA). Só no site publicado; no "npm run dev" atrapalharia o recarregamento.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('[App] Service worker:', e)))
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
