import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { Json } from '../lib/types'
import { useAuth } from './AuthContext'
import { usePlaces } from './PlacesContext'

/**
 * Toutes les demandes faites a l'IA (analyseur du PC), suivies en direct.
 * On peut en lancer plusieurs, changer d'ecran, quitter l'app : elles
 * continuent sur le PC et le resultat arrive tout seul. Ce contexte les
 * liste pour la pastille « IA en cours » et recharge les lieux quand une
 * demande qui les modifie se termine.
 */
export type AiJob = {
  id: string
  kind: string
  trip_id: string | null
  input: Record<string, unknown>
  status: 'pending' | 'processing' | 'ready' | 'error'
  result: Json | null
  error: string | null
  /** Avancement reel (0-100) et etape en cours, ecrits par l'analyseur. */
  progress?: number
  step?: string | null
  created_at: string
  updated_at: string
}

type Value = {
  jobs: AiJob[]
  queue: (kind: string, input: Record<string, unknown>, tripId: string | null) => Promise<AiJob>
  /** Demande en cours pour ce lieu (remplissage, date proposee...). */
  activeFor: (kind: string, key: string, value: string) => AiJob | undefined
  dismiss: (id: string) => void
}

const Ctx = createContext<Value | null>(null)
const RECENT_MS = 30 * 60 * 1000
const CHANGES_PLACES = new Set(['place_info', 'arrange_trip', 'day_plan', 'stop_places'])

export function AiJobsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { reload } = usePlaces()
  const [jobs, setJobs] = useState<AiJob[]>([])
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const known = useRef(new Map<string, string>())

  const load = useCallback(async () => {
    if (!user) return
    const since = new Date(Date.now() - RECENT_MS).toISOString()
    const { data } = await supabase
      .from('ai_jobs')
      .select('id, kind, trip_id, input, status, result, error, progress, step, created_at, updated_at')
      .eq('user_id', user.id)
      .or(`status.in.(pending,processing),updated_at.gt.${since}`)
      .order('created_at', { ascending: false })
      .limit(40)
    const rows = (data ?? []) as unknown as AiJob[]
    // Une demande qui vient de se terminer et qui touche aux lieux : on recharge
    let refresh = false
    for (const j of rows) {
      const before = known.current.get(j.id)
      if (before && before !== j.status && j.status === 'ready' && CHANGES_PLACES.has(j.kind)) refresh = true
      known.current.set(j.id, j.status)
    }
    setJobs(rows)
    if (refresh) void reload()
  }, [user, reload])

  useEffect(() => {
    if (!user) return
    void load()
    const channel = supabase
      .channel(`ai-jobs-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_jobs', filter: `user_id=eq.${user.id}` }, () => void load())
      .subscribe()
    // Filet de securite si le temps reel ne passe pas
    const poll = window.setInterval(() => document.visibilityState === 'visible' && void load(), 8000)
    const onVisible = () => document.visibilityState === 'visible' && void window.setTimeout(() => void load(), 500)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
      void supabase.removeChannel(channel)
    }
  }, [user, load])

  const queue = useCallback(
    async (kind: string, input: Record<string, unknown>, tripId: string | null) => {
      const { data, error } = await supabase
        .from('ai_jobs')
        .insert({ kind, trip_id: tripId, input: input as Json })
        .select('id, kind, trip_id, input, status, result, error, progress, step, created_at, updated_at')
        .single()
      if (error) throw error
      const job = data as unknown as AiJob
      known.current.set(job.id, job.status)
      setJobs((prev) => [job, ...prev])
      return job
    },
    [],
  )

  const value = useMemo<Value>(
    () => ({
      jobs: jobs.filter((j) => !hidden.has(j.id)),
      queue,
      activeFor: (kind, key, v) =>
        jobs.find((j) => j.kind === kind && (j.status === 'pending' || j.status === 'processing') && String(j.input?.[key]) === v),
      dismiss: (id) => setHidden((s) => new Set(s).add(id)),
    }),
    [jobs, hidden, queue],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAiJobs() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAiJobs doit etre utilise dans AiJobsProvider')
  return ctx
}
