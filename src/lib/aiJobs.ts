import { supabase } from './supabase'
import type { Json } from './types'

/**
 * Demande a l'IA traitee par l'analyseur du PC (Claude Code + abonnement).
 * On depose la demande, puis on attend le resultat en temps reel, avec une
 * relecture toutes les 5 s au cas ou le temps reel ne passe pas.
 */
type JobRow = { id: string; status: string; result: Json | null; error: string | null }

const TIMEOUT_MS = 20 * 60 * 1000

export async function runAiJob<T>(kind: string, input: unknown, tripId: string | null): Promise<T> {
  const { data, error } = await supabase
    .from('ai_jobs')
    .insert({ kind, trip_id: tripId, input: input as Json })
    .select('id, status, result, error')
    .single()
  if (error) throw error
  const job = data as JobRow

  return new Promise<T>((resolve, reject) => {
    let done = false
    const finish = (row: JobRow) => {
      if (done) return
      if (row.status === 'ready' && row.result) {
        done = true
        cleanup()
        resolve(row.result as unknown as T)
      } else if (row.status === 'error') {
        done = true
        cleanup()
        reject(new Error(row.error || "L'IA n'a pas pu repondre."))
      }
    }
    const channel = supabase
      .channel(`ai-job-${job.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'ai_jobs', filter: `id=eq.${job.id}` },
        (msg) => finish(msg.new as JobRow),
      )
      .subscribe()
    const poll = window.setInterval(async () => {
      const { data: row } = await supabase.from('ai_jobs').select('id, status, result, error').eq('id', job.id).single()
      if (row) finish(row as JobRow)
    }, 5000)
    const timeout = window.setTimeout(() => {
      if (done) return
      done = true
      cleanup()
      reject(new Error("Pas de reponse de l'analyseur. Le PC est-il allume ?"))
    }, TIMEOUT_MS)
    function cleanup() {
      window.clearInterval(poll)
      window.clearTimeout(timeout)
      void supabase.removeChannel(channel)
    }
  })
}
