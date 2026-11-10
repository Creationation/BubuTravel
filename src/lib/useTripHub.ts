import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createDocument,
  createStop,
  createTodo,
  deleteDocument,
  deleteStop,
  deleteTodo,
  fetchDocuments,
  fetchStops,
  fetchTodos,
  fetchTripPeople,
  updateDocument,
  updateStop,
  updateTodo,
} from './tripApi'
import { supabase } from './supabase'
import { errorMessage, isMissingTable } from './errors'
import type {
  NewTripDocument,
  NewTripStop,
  NewTripTodo,
  TripDocument,
  TripPerson,
  TripStop,
  TripTodo,
} from './types'

/**
 * Etat d'un voyage ouvert : etapes, a faire, documents, voyageurs.
 * A deux sur le meme voyage, chacun voit les ajouts de l'autre en direct
 * (Realtime) et, a defaut, au retour sur l'onglet.
 */
export function useTripHub(tripId: string | undefined) {
  const [stops, setStops] = useState<TripStop[]>([])
  const [todos, setTodos] = useState<TripTodo[]>([])
  const [docs, setDocs] = useState<TripDocument[]>([])
  const [people, setPeople] = useState<TripPerson[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** La migration 008 n'est pas encore appliquee : on le dit clairement. */
  const [missingSchema, setMissingSchema] = useState(false)

  const reload = useCallback(async () => {
    if (!tripId) return
    const results = await Promise.allSettled([
      fetchStops(tripId),
      fetchTodos(tripId),
      fetchDocuments(tripId),
      fetchTripPeople(tripId),
    ])
    const [rs, rt, rd, rp] = results
    if (rs.status === 'fulfilled') setStops(rs.value)
    if (rt.status === 'fulfilled') setTodos(rt.value)
    if (rd.status === 'fulfilled') setDocs(rd.value)
    if (rp.status === 'fulfilled') setPeople(rp.value)
    const failure = results.find((r) => r.status === 'rejected')
    if (failure && failure.status === 'rejected') {
      setMissingSchema(isMissingTable(failure.reason))
      setError(errorMessage(failure.reason))
    } else {
      setMissingSchema(false)
      setError(null)
    }
    setLoading(false)
  }, [tripId])

  useEffect(() => {
    setLoading(true)
    void reload()
  }, [reload])

  // Retour sur l'onglet : on relit, l'autre voyageur a pu ajouter des choses
  useEffect(() => {
    // Au retour d'arriere-plan l'ecran s'affiche d'abord avec ce qu'on a deja ;
    // on relit apres un court instant et pas plus d'une fois par 30 s (le
    // temps reel couvre le reste), pour que l'ouverture reste instantanee.
    let last = Date.now()
    let timer: number | undefined
    const onFocus = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 30_000) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        last = Date.now()
        void reload()
      }, 600)
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [reload])

  // Temps reel : un changement sur l'une des tables du voyage declenche une
  // relecture groupee (les evenements arrivent souvent en rafale).
  useEffect(() => {
    if (!tripId) return
    let timer: number | undefined
    const bump = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void reload(), 400)
    }
    const channel = supabase.channel(`trip-${tripId}`)
    for (const table of ['trip_stops', 'trip_todos', 'trip_documents']) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `trip_id=eq.${tripId}` },
        bump,
      )
    }
    channel.subscribe()
    return () => {
      window.clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [tripId, reload])

  const actions = useMemo(
    () => ({
      async addStop(input: Omit<NewTripStop, 'trip_id' | 'position'> & { position?: number }) {
        if (!tripId) throw new Error('trip')
        const position = input.position ?? (stops.length ? Math.max(...stops.map((s) => s.position)) + 1 : 0)
        const created = await createStop({ ...input, trip_id: tripId, position })
        setStops((prev) => [...prev, created].sort((a, b) => a.position - b.position))
        return created
      },
      async editStop(id: string, patch: Partial<NewTripStop>) {
        const updated = await updateStop(id, patch)
        setStops((prev) => prev.map((s) => (s.id === id ? updated : s)).sort((a, b) => a.position - b.position))
        return updated
      },
      async removeStop(id: string) {
        await deleteStop(id)
        setStops((prev) => prev.filter((s) => s.id !== id))
      },
      /** Echange deux etapes et renumerote d'un bloc, sans trous ni egalites. */
      async moveStop(index: number, delta: number) {
        const ordered = [...stops].sort((a, b) => a.position - b.position)
        const target = index + delta
        if (target < 0 || target >= ordered.length) return
        ;[ordered[index], ordered[target]] = [ordered[target], ordered[index]]
        setStops(ordered.map((s, i) => ({ ...s, position: i })))
        for (let i = 0; i < ordered.length; i++) {
          if (ordered[i].position !== i) await updateStop(ordered[i].id, { position: i })
        }
      },
      async addTodo(input: Partial<NewTripTodo> & Pick<NewTripTodo, 'title'>) {
        if (!tripId) throw new Error('trip')
        const position = todos.length ? Math.max(...todos.map((t) => t.position)) + 1 : 0
        const created = await createTodo({ ...input, trip_id: tripId, position })
        setTodos((prev) => [...prev, created])
        return created
      },
      async editTodo(id: string, patch: Partial<NewTripTodo>) {
        // Optimiste : cocher doit etre instantane, meme en reseau lent
        setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
        try {
          const updated = await updateTodo(id, patch)
          setTodos((prev) => prev.map((t) => (t.id === id ? updated : t)))
          return updated
        } catch (err) {
          void reload()
          throw err
        }
      },
      async removeTodo(id: string) {
        setTodos((prev) => prev.filter((t) => t.id !== id))
        await deleteTodo(id)
      },
      async addDoc(
        input: Partial<NewTripDocument> & Pick<NewTripDocument, 'title' | 'kind'>,
        file: File | null,
      ) {
        if (!tripId) throw new Error('trip')
        const created = await createDocument({ ...input, trip_id: tripId }, file)
        setDocs((prev) => [...prev, created])
        return created
      },
      async editDoc(id: string, patch: Partial<NewTripDocument>) {
        const updated = await updateDocument(id, patch)
        setDocs((prev) => prev.map((d) => (d.id === id ? updated : d)))
        return updated
      },
      async removeDoc(doc: TripDocument) {
        await deleteDocument(doc)
        setDocs((prev) => prev.filter((d) => d.id !== doc.id))
      },
    }),
    [tripId, stops, todos, reload],
  )

  const orderedStops = useMemo(() => [...stops].sort((a, b) => a.position - b.position), [stops])

  return { stops: orderedStops, todos, docs, people, loading, error, missingSchema, reload, ...actions }
}

export type TripHub = ReturnType<typeof useTripHub>
