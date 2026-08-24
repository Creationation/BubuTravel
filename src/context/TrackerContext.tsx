import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { appendPoint, messageFor, trackDistanceKm } from '../lib/geolocation'
import type { TrackPoint } from '../lib/types'

const DRAFT_KEY = 'bubutravel:track-draft'

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
 * ecrite dans localStorage a chaque point : un rechargement de page, ou un
 * telephone qui met l'onglet en veille, ne doit pas effacer une randonnee.
 * Le suivi reprend tout seul au retour sur la page.
 */
export function TrackerProvider({ children }: { children: ReactNode }) {
  const [recording, setRecording] = useState<Recording | null>(loadDraft)
  const [error, setError] = useState<string | null>(null)
  const watchRef = useRef<number | null>(null)

  // Persistance de la trace en cours
  useEffect(() => {
    if (recording) localStorage.setItem(DRAFT_KEY, JSON.stringify(recording))
    else localStorage.removeItem(DRAFT_KEY)
  }, [recording])

  const stopWatch = useCallback(() => {
    if (watchRef.current !== null) {
      navigator.geolocation.clearWatch(watchRef.current)
      watchRef.current = null
    }
  }, [])

  // Le suivi tourne tant qu'un enregistrement est actif et non suspendu
  useEffect(() => {
    if (!recording || recording.paused) {
      stopWatch()
      return
    }
    if (watchRef.current !== null) return
    if (!('geolocation' in navigator)) {
      setError("Ce navigateur ne sait pas suivre la position.")
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
          return added ? { ...prev, points } : prev
        })
      },
      (err) => setError(messageFor(err)),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    )

    return stopWatch
  }, [recording, stopWatch])

  useEffect(() => stopWatch, [stopWatch])

  const value = useMemo<TrackerValue>(
    () => ({
      recording,
      distanceKm: recording ? trackDistanceKm(recording.points) : 0,
      error,
      start() {
        setError(null)
        setRecording({ points: [], startedAt: new Date().toISOString(), paused: false })
      },
      pause() {
        setRecording((prev) => (prev ? { ...prev, paused: true } : prev))
      },
      resume() {
        setRecording((prev) => (prev ? { ...prev, paused: false } : prev))
      },
      discard() {
        stopWatch()
        setRecording(null)
        setError(null)
      },
      finish() {
        if (!recording) return null
        stopWatch()
        const result = {
          points: recording.points,
          startedAt: recording.startedAt,
          endedAt: new Date().toISOString(),
          distanceKm: trackDistanceKm(recording.points),
        }
        setRecording(null)
        return result
      },
    }),
    [recording, error, stopWatch],
  )

  return <TrackerContext.Provider value={value}>{children}</TrackerContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTracker() {
  const ctx = useContext(TrackerContext)
  if (!ctx) throw new Error('useTracker doit etre utilise dans TrackerProvider')
  return ctx
}
