import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  countPhotos,
  createPlace,
  createTrip,
  deletePlace,
  deleteTrack,
  deleteTrip,
  fetchPlaces,
  fetchTracks,
  fetchTrips,
  updatePlace,
  updateTrip,
} from '../lib/api'
import type { NewPlace, NewTrip, Place, Track, Trip } from '../lib/types'
import { buildStats } from '../lib/stats'
import type { Stats } from '../lib/stats'
import { useAuth } from './AuthContext'
import { friendlyError } from '../lib/errors'

type PlacesValue = {
  places: Place[]
  trips: Trip[]
  tracks: Track[]
  loading: boolean
  error: string | null
  countries: string[]
  stats: Stats
  placesOfTrip: (tripId: string) => Place[]
  add: (input: Omit<NewPlace, 'user_id'>) => Promise<Place>
  edit: (id: string, patch: Partial<NewPlace>) => Promise<Place>
  remove: (place: Place) => Promise<void>
  addTrip: (input: Omit<NewTrip, 'user_id'>) => Promise<Trip>
  editTrip: (id: string, patch: Partial<NewTrip>) => Promise<Trip>
  removeTrip: (id: string) => Promise<void>
  pushTrack: (track: Track) => void
  removeTrack: (id: string) => Promise<void>
  bumpPhotoCount: (delta: number) => void
  reload: () => Promise<void>
}

const PlacesContext = createContext<PlacesValue | null>(null)

export function PlacesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [places, setPlaces] = useState<Place[]>([])
  const [trips, setTrips] = useState<Trip[]>([])
  const [tracks, setTracks] = useState<Track[]>([])
  const [photoCount, setPhotoCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!user) {
      setPlaces([])
      setTrips([])
      setTracks([])
      setPhotoCount(0)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [p, t, k, c] = await Promise.all([
        fetchPlaces(user.id),
        fetchTrips(user.id),
        fetchTracks(user.id),
        countPhotos(user.id),
      ])
      setPlaces(p)
      setTrips(t)
      setTracks(k)
      setPhotoCount(c)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void reload()
  }, [reload])

  const value = useMemo<PlacesValue>(() => {
    const countries = [...new Set(places.map((p) => p.country).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, 'fr'),
    )

    return {
      places,
      trips,
      tracks,
      loading,
      error,
      countries,
      stats: buildStats(places, photoCount),
      placesOfTrip: (tripId) =>
        sortPlaces(places.filter((p) => p.trip_id === tripId)).reverse(),
      async add(input) {
        if (!user) throw new Error('Non connecte')
        const created = await createPlace({ ...input, user_id: user.id })
        setPlaces((prev) => sortPlaces([created, ...prev]))
        return created
      },
      async edit(id, patch) {
        const updated = await updatePlace(id, patch)
        setPlaces((prev) => sortPlaces(prev.map((p) => (p.id === id ? updated : p))))
        return updated
      },
      async remove(place) {
        await deletePlace(place)
        setPlaces((prev) => prev.filter((p) => p.id !== place.id))
        void refreshPhotoCount()
      },
      async addTrip(input) {
        if (!user) throw new Error('Non connecte')
        const created = await createTrip({ ...input, user_id: user.id })
        setTrips((prev) => sortTrips([created, ...prev]))
        return created
      },
      async editTrip(id, patch) {
        const updated = await updateTrip(id, patch)
        setTrips((prev) => sortTrips(prev.map((t) => (t.id === id ? updated : t))))
        return updated
      },
      async removeTrip(id) {
        await deleteTrip(id)
        setTrips((prev) => prev.filter((t) => t.id !== id))
        // Les lieux ne sont pas supprimes, ils perdent seulement leur voyage
        setPlaces((prev) => prev.map((p) => (p.trip_id === id ? { ...p, trip_id: null } : p)))
      },
      pushTrack: (track) => setTracks((prev) => [track, ...prev]),
      async removeTrack(id) {
        await deleteTrack(id)
        setTracks((prev) => prev.filter((t) => t.id !== id))
      },
      bumpPhotoCount: (delta) => setPhotoCount((c) => Math.max(0, c + delta)),
      reload,
    }

    async function refreshPhotoCount() {
      if (!user) return
      try {
        setPhotoCount(await countPhotos(user.id))
      } catch {
        // Le compteur n'est pas critique, on ne casse pas l'ecran pour ca
      }
    }
  }, [places, trips, tracks, photoCount, loading, error, user, reload])

  return <PlacesContext.Provider value={value}>{children}</PlacesContext.Provider>
}

function sortPlaces(list: Place[]): Place[] {
  return [...list].sort((a, b) => {
    if (!a.visit_date && !b.visit_date) return a.name.localeCompare(b.name, 'fr')
    if (!a.visit_date) return 1
    if (!b.visit_date) return -1
    return b.visit_date.localeCompare(a.visit_date)
  })
}

function sortTrips(list: Trip[]): Trip[] {
  return [...list].sort((a, b) => {
    if (!a.start_date && !b.start_date) return a.title.localeCompare(b.title, 'fr')
    if (!a.start_date) return 1
    if (!b.start_date) return -1
    return b.start_date.localeCompare(a.start_date)
  })
}


// eslint-disable-next-line react-refresh/only-export-components
export function usePlaces() {
  const ctx = useContext(PlacesContext)
  if (!ctx) throw new Error('usePlaces doit etre utilise dans PlacesProvider')
  return ctx
}
