import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  countPhotos,
  createCategory,
  createEvent,
  createPlace,
  createTrip,
  deleteCategory,
  deleteEvent,
  deletePlace,
  deleteTrack,
  deleteTrip,
  fetchCategories,
  fetchEvents,
  fetchPlaces,
  fetchTracks,
  fetchTrips,
  seedCategories,
  updateCategory,
  updateEvent,
  updatePlace,
  updateTrip,
} from '../lib/api'
import type {
  Category,
  NewEvent,
  NewPlace,
  NewTrip,
  Place,
  Track,
  TravelEvent,
  Trip,
} from '../lib/types'
import { buildStats } from '../lib/stats'
import type { Stats } from '../lib/stats'
import { useAuth } from './AuthContext'
import { errorMessage, isMissingTable } from '../lib/errors'
import { useT } from '../i18n/I18nContext'

type PlacesValue = {
  /** Tous les lieux, visites et souhaites confondus. */
  places: Place[]
  /** Uniquement les lieux deja visites : c'est le carnet. */
  visited: Place[]
  /** Uniquement les lieux a visiter : c'est la bucketlist. */
  wishlist: Place[]
  trips: Trip[]
  tracks: Track[]
  categories: Category[]
  events: TravelEvent[]
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
  addCategory: (name: string, color: string) => Promise<Category>
  editCategory: (id: string, patch: { name?: string; color?: string }) => Promise<Category>
  removeCategory: (id: string) => Promise<void>
  seedDefaultCategories: () => Promise<void>
  categoryOf: (place: Place) => Category | null
  addEvent: (input: Omit<NewEvent, 'user_id'>) => Promise<TravelEvent>
  editEvent: (id: string, patch: Partial<NewEvent>) => Promise<TravelEvent>
  removeEvent: (id: string) => Promise<void>
  bumpPhotoCount: (delta: number) => void
  reload: () => Promise<void>
}

const PlacesContext = createContext<PlacesValue | null>(null)

export function PlacesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const t = useT()
  const [places, setPlaces] = useState<Place[]>([])
  const [trips, setTrips] = useState<Trip[]>([])
  const [tracks, setTracks] = useState<Track[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [events, setEvents] = useState<TravelEvent[]>([])
  const [photoCount, setPhotoCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!user) {
      setPlaces([])
      setTrips([])
      setTracks([])
      setCategories([])
      setEvents([])
      setPhotoCount(0)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      /*
       * allSettled et non all : avec all, une seule source en echec, par
       * exemple une table pas encore migree, vidait TOUT le carnet. Les
       * lieux deja charges n'ont aucune raison de disparaitre parce que la
       * table des evenements manque.
       */
      const [rPlaces, rTrips, rTracks, rCats, rEvents, rCount] = await Promise.allSettled([
        fetchPlaces(user.id),
        fetchTrips(user.id),
        fetchTracks(user.id),
        fetchCategories(user.id),
        fetchEvents(user.id),
        countPhotos(user.id),
      ])

      if (rPlaces.status === 'fulfilled') setPlaces(rPlaces.value)
      if (rTrips.status === 'fulfilled') setTrips(rTrips.value)
      if (rTracks.status === 'fulfilled') setTracks(rTracks.value)
      if (rCats.status === 'fulfilled') setCategories(rCats.value)
      if (rEvents.status === 'fulfilled') setEvents(rEvents.value)
      if (rCount.status === 'fulfilled') setPhotoCount(rCount.value)

      // Une migration manquante se signale une fois, sans masquer le reste
      const failure = [rPlaces, rTrips, rTracks, rCats, rEvents, rCount].find(
        (r) => r.status === 'rejected',
      )
      if (failure && failure.status === 'rejected') {
        setError(
          isMissingTable(failure.reason)
            ? t('error.missingTable')
            : errorMessage(failure.reason),
        )
      }
    } catch (err) {
      setError(isMissingTable(err) ? t('error.missingTable') : errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [user, t])

  useEffect(() => {
    void reload()
  }, [reload])

  const value = useMemo<PlacesValue>(() => {
    const countries = [...new Set(places.map((p) => p.country).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, 'fr'),
    )

    const visited = places.filter((p) => p.status !== 'wishlist')
    const wishlist = places.filter((p) => p.status === 'wishlist')
    const byId = new Map(categories.map((c) => [c.id, c]))

    return {
      places,
      visited,
      wishlist,
      trips,
      tracks,
      categories,
      events,
      loading,
      error,
      countries,
      // Les compteurs du carnet ne comptent que ce qui a ete reellement visite
      stats: buildStats(visited, photoCount),
      placesOfTrip: (tripId) => sortPlaces(places.filter((p) => p.trip_id === tripId)).reverse(),
      async add(input) {
        if (!user) throw new Error(t('error.notSignedIn'))
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
        if (!user) throw new Error(t('error.notSignedIn'))
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
      async addCategory(name, color) {
        if (!user) throw new Error(t('error.notSignedIn'))
        const created = await createCategory({ user_id: user.id, name, color, icon: null })
        setCategories((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name, 'fr')))
        return created
      },
      async editCategory(id, patch) {
        const updated = await updateCategory(id, patch)
        setCategories((prev) =>
          prev.map((c) => (c.id === id ? updated : c)).sort((a, b) => a.name.localeCompare(b.name, 'fr')),
        )
        return updated
      },
      async removeCategory(id) {
        await deleteCategory(id)
        setCategories((prev) => prev.filter((c) => c.id !== id))
        // Les lieux gardent leur ligne, ils perdent juste la categorie
        setPlaces((prev) =>
          prev.map((p) => (p.category_id === id ? { ...p, category_id: null } : p)),
        )
      },
      async seedDefaultCategories() {
        if (!user) throw new Error(t('error.notSignedIn'))
        const created = await seedCategories(user.id)
        setCategories((prev) =>
          [...prev, ...created].sort((a, b) => a.name.localeCompare(b.name, 'fr')),
        )
      },
      categoryOf: (place) => (place.category_id ? (byId.get(place.category_id) ?? null) : null),
      async addEvent(input) {
        if (!user) throw new Error(t('error.notSignedIn'))
        const created = await createEvent({ ...input, user_id: user.id })
        setEvents((prev) => [...prev, created])
        return created
      },
      async editEvent(id, patch) {
        const updated = await updateEvent(id, patch)
        setEvents((prev) => prev.map((e) => (e.id === id ? updated : e)))
        return updated
      },
      async removeEvent(id) {
        await deleteEvent(id)
        setEvents((prev) => prev.filter((e) => e.id !== id))
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
  }, [places, trips, tracks, categories, events, photoCount, loading, error, user, reload])

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
