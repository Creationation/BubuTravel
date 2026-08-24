import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { createPlace, deletePlace, fetchPlaces, updatePlace } from '../lib/api'
import type { NewPlace, Place } from '../lib/types'
import { useAuth } from './AuthContext'

type PlacesValue = {
  places: Place[]
  loading: boolean
  error: string | null
  countries: string[]
  add: (input: Omit<NewPlace, 'user_id'>) => Promise<Place>
  edit: (id: string, patch: Partial<NewPlace>) => Promise<Place>
  remove: (place: Place) => Promise<void>
  reload: () => Promise<void>
}

const PlacesContext = createContext<PlacesValue | null>(null)

export function PlacesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [places, setPlaces] = useState<Place[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!user) {
      setPlaces([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      setPlaces(await fetchPlaces(user.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
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
      loading,
      error,
      countries,
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
      },
      reload,
    }
  }, [places, loading, error, user, reload])

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

// eslint-disable-next-line react-refresh/only-export-components
export function usePlaces() {
  const ctx = useContext(PlacesContext)
  if (!ctx) throw new Error('usePlaces doit etre utilise dans PlacesProvider')
  return ctx
}
