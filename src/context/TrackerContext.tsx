import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { appendPoint, messageFor, trackDistanceKm } from '../lib/geolocation'
import type { TrackPoint } from '../lib/types'

const DRAFT_KEY = 'bubutravel:track-draft'

/** Ecriture disque au plus une fois toutes les 15 s, voir plus bas. */
const PERSIST_EVERY_MS = 15000

type Recording = {
  points: TrackPoint[]
  startedAt: string
  paused: boolean
}

type TrackerValue = {
  recording: Recording | null
  distanceKm: number
  error: string | null
  start: () => void
  pause: () => void
  resume: () => void
  discard: () => void
  /** Rend la trace en cours et arrete l'enregistrement. */
  finish: () => { points: TrackPoint[]; startedAt: string; endedAt: string; distanceKm: number } | null
}

const TrackerContext = createContext<TrackerValue | null>(null)

function loadDraft(): Recording | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Recording
    if (!Array.isArray(parsed.points) || !parsed.startedAt) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Enregistrement d'un parcours par watchPosition. La trace en cours est
 * conservee dans localStorage : un rechargement de page, ou un telephone qui
 * met l'onglet en veille, ne doit pas effacer une randonnee.
 */
export function TrackerProvider({ children }: { children: ReactNode }) {
  const [recording, setRecording] = useState<Recording | null>(loadDraft)
  const [error, setError] = useState<string | null>(null)
  const watchRef = useRef<number | null>(null)
  const lastPersistRef = useRef(0)
  const recordingRef = useRef(recording)

  recordingRef.current = recording

  /**
   * Le suivi ne depend que d'un booleen, jamais de l'objet complet. Sinon
   * chaque point recu changeait l'etat, relançait l'effet, coupait le suivi
   * puis en ouvrait un autre : le GPS ne se stabilisait jamais et les
   * abonnements s'empilaient jusqu'a bloquer l'app sur une longue sortie.
   */
  const active = recording !== null && !recording.paused

  const stopWatch = useCallback(() => {
    if (watchRef.current !== null) {
      navigator.geolocation.clearWatch(watchRef.current)
      watchRef.current = null
    }
  }, [])

  /**
   * Ecriture disque limitee. Ecrire la trace entiere a chaque point coute de
   * plus en plus cher a mesure qu'elle grandit : au bout d'une heure de
   * marche, chaque point recopiait des milliers d'entrees, ce qui figeait
   * l'interface. On ecrit au plus toutes les 15 s, et systematiquement aux
   * moments qui comptent (pause, arret, fermeture de l'onglet).
   */
  const persist = useCallback((value: Recording | null, force = false) => {
    const now = Date.now()
    if (!force && now - lastPersistRef.current < PERSIST_EVERY_MS) return
    lastPersistRef.current = now
    try {
      if (value) localStorage.setItem(DRAFT_KEY, JSON.stringify(value))
      else localStorage.removeItem(DRAFT_KEY)
    } catch {
      // Quota plein : l'enregistrement continue, seule la reprise est perdue
    }
  }, [])

  useEffect(() => {
    if (!active) {
      stopWatch()
      return
    }
    if (!('geolocation' in navigator)) {
      setError('Ce navigateur ne sait pas suivre la position.')
      return
    }

    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setError(null)
        setRecording((prev) => {
          if (!prev || prev.paused) return prev
          const { points, added } = appendPoint(prev.points, {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            t: pos.timestamp,
          })
          if (!added) return prev
          const next = { ...prev, points }
          persist(next)
          return next
        })
      },
      (err) => setError(messageFor(err)),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    )

    return stopWatch
  }, [active, stopWatch, persist])

  // Une fermeture d'onglet ne doit pas perdre les derniers points
  useEffect(() => {
    function flush() {
      persist(recordingRef.current, true)
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', flush)
    }
  }, [persist])

  useEffect(() => stopWatch, [stopWatch])

  const value = useMemo<TrackerValue>(
    () => ({
      recording,
      distanceKm: recording ? trackDistanceKm(recording.points) : 0,
      error,
      start() {
        setError(null)
        const next = { points: [], startedAt: new Date().toISOString(), paused: false }
        setRecording(next)
        persist(next, true)
      },
      pause() {
        setRecording((prev) => {
          if (!prev) return prev
          const next = { ...prev, paused: true }
          persist(next, true)
          return next
        })
      },
      resume() {
        setRecording((prev) => (prev ? { ...prev, paused: false } : prev))
      },
      discard() {
        stopWatch()
        setRecording(null)
        persist(null, true)
        setError(null)
      },
      finish() {
        const current = recordingRef.current
        if (!current) return null
        stopWatch()
        const result = {
          points: current.points,
          startedAt: current.startedAt,
          endedAt: new Date().toISOString(),
          distanceKm: trackDistanceKm(current.points),
        }
        setRecording(null)
        persist(null, true)
        return result
      },
    }),
    [recording, error, stopWatch, persist],
  )

  return <TrackerContext.Provider value={value}>{children}</TrackerContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTracker() {
  const ctx = useContext(TrackerContext)
  if (!ctx) throw new Error('useTracker doit etre utilise dans TrackerProvider')
  return ctx
}
