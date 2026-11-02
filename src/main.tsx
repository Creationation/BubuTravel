import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary'
import { recordAppError } from './lib/errors'

window.addEventListener('error', (event) => {
  recordAppError(event.error ?? event.message, 'window', `${event.filename}:${event.lineno}:${event.colno}`)
})
window.addEventListener('unhandledrejection', (event) => {
  recordAppError(event.reason, 'promise')
})

/**
 * Clic fantome (surtout au doigt) : on appuie sur un element qui disparait
 * avant le relachement (feuille qui se ferme, bouton remplace), et le clic
 * retombe sur ce qui se trouve dessous. On l'annule, ainsi qu'un second clic
 * parasite sur la meme zone juste apres la fermeture d'une fenetre.
 */
let downTarget: Element | null = null
let lastDown = 0
window.addEventListener(
  'pointerdown',
  (e) => {
    downTarget = e.target instanceof Element ? e.target : null
    lastDown = Date.now()
  },
  true,
)
window.addEventListener(
  'click',
  (e) => {
    if (!downTarget || Date.now() - lastDown > 1500) return
    if (!downTarget.isConnected) {
      e.stopPropagation()
      e.preventDefault()
    }
  },
  true,
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
