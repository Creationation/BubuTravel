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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
