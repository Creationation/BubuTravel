import { supabase } from './supabase'
import type { TodoKind, TransportMode } from './types'

/** Miroir du schema de api/itinerary.ts. */
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

export async function requestItinerary(payload: ItineraryRequest): Promise<AiItinerary> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Connexion requise')

  const res = await fetch('/api/itinerary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    let message = `L'assistant a repondu ${res.status}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // Reponse non JSON (page d'erreur Vercel) : on garde le code
    }
    throw new Error(message)
  }
  return (await res.json()) as AiItinerary
}
