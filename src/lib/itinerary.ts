import { supabase } from './supabase'
import type { Json, TodoKind, TransportMode } from './types'

/**
 * Assistant d'itineraire. La demande n'appelle pas d'API depuis Vercel : elle
 * est deposee dans ai_jobs et traitee par l'analyseur du PC, via Claude Code
 * et l'abonnement Claude. On attend le resultat en temps reel.
 */

export type AiTransport = {
  mode: TransportMode
  details: string
  duration_hours: number
  price_estimate: number
  currency: string
  how_to_book: string
  book_ahead_days: number
}

export type AiStop = {
  name: string
  country: string
  lat: number
  lng: number
  arrive_date: string
  leave_date: string
  why: string
  highlights: string[]
  stay_tip: string
  transport_to_next: AiTransport | null
}

export type AiItinerary = {
  summary: string
  stops: AiStop[]
  todos: { title: string; kind: TodoKind; due_date: string; notes: string }[]
  admin: { title: string; detail: string }[]
}

export type ItineraryRequest = {
  raw: string
  start_date: string | null
  end_date: string | null
  travellers: number
  budget: 'petit' | 'moyen' | 'confortable' | 'luxe'
  pace: 'tranquille' | 'equilibre' | 'dense'
  nationality: string
  lang: 'fr' | 'en'
  today: string
  existing: { name: string; arrive_date: string | null; leave_date: string | null }[]
}

type JobRow = { id: string; status: string; result: Json | null; error: string | null }

const TIMEOUT_MS = 15 * 60 * 1000

export async function requestItinerary(payload: ItineraryRequest, tripId: string): Promise<AiItinerary> {
  const { data, error } = await supabase
    .from('ai_jobs')
    .insert({ kind: 'itinerary', trip_id: tripId, input: payload as unknown as Json })
    .select('id, status, result, error')
    .single()
  if (error) throw error
  const job = data as JobRow

  return new Promise<AiItinerary>((resolve, reject) => {
    let done = false
    const finish = (row: JobRow) => {
      if (done) return
      if (row.status === 'ready' && row.result) {
        done = true
        cleanup()
        resolve(row.result as unknown as AiItinerary)
      } else if (row.status === 'error') {
        done = true
        cleanup()
        reject(new Error(row.error || "L'assistant n'a pas pu repondre."))
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
    // Filet de securite si le temps reel ne passe pas
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
