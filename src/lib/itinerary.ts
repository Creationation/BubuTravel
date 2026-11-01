import { runAiJob } from './aiJobs'
import type { TodoKind, TransportMode } from './types'

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

export function requestItinerary(payload: ItineraryRequest, tripId: string): Promise<AiItinerary> {
  return runAiJob<AiItinerary>('itinerary', payload, tripId)
}
