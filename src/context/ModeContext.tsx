import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * Mode simple ou avance. Simple par defaut : seulement l'essentiel, gros
 * boutons, les options rares cachees. Avance : toutes les pages et tous les
 * champs. Le choix est garde sur l'appareil (le telephone en simple, le PC
 * en avance, par exemple).
 */
export type Mode = 'simple' | 'advanced'

const KEY = 'bubutravel:mode'
const ModeContext = createContext<{ mode: Mode; setMode: (m: Mode) => void; advanced: boolean } | null>(null)

function readMode(): Mode {
  try {
    return window.localStorage.getItem(KEY) === 'advanced' ? 'advanced' : 'simple'
  } catch {
    return 'simple'
  }
}

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(readMode)
  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, mode)
    } catch {
      // Stockage indisponible : le mode vaut pour la session
    }
  }, [mode])
  return (
    <ModeContext.Provider value={{ mode, setMode, advanced: mode === 'advanced' }}>{children}</ModeContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useMode() {
  const ctx = useContext(ModeContext)
  if (!ctx) throw new Error('useMode doit etre utilise dans ModeProvider')
  return ctx
}
