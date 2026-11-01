import { runAiJob } from './aiJobs'
import { supabase } from './supabase'
import type { Json, Place, TripStop } from './types'

/**
 * « Choses a voir » d'une etape : l'analyseur (Claude via l'abonnement)
 * trouve 6 a 10 incontournables avec leurs coordonnees et les ajoute au
 * voyage en lieux « a visiter ». Ils apparaissent alors sur la carte.
 */
function payload(stop: TripStop, places: Place[], lang: 'fr' | 'en') {
  return {
    stop: stop.name,
    country: stop.country ?? '',
    arrive_date: stop.arrive_date,
    leave_date: stop.leave_date,
    existing: places.filter((p) => p.trip_id === stop.trip_id).map((p) => p.name),
    lang,
  }
}

/** Attend le resultat (bouton sur une etape). */
export function findSights(stop: TripStop, places: Place[], lang: 'fr' | 'en') {
  return runAiJob<{ added: number }>('stop_places', payload(stop, places, lang), stop.trip_id)
}

/** Depose les demandes sans attendre (apres l'import de l'assistant). */
export async function queueSights(stops: TripStop[], places: Place[], lang: 'fr' | 'en') {
  if (stops.length === 0) return
  const rows = stops.map((s) => ({
    kind: 'stop_places',
    trip_id: s.trip_id,
    input: payload(s, places, lang) as unknown as Json,
  }))
  const { error } = await supabase.from('ai_jobs').insert(rows)
  if (error) throw error
}

/** Lieux a visiter rattaches a une etape (meme ville, ou note de l'analyseur). */
export function sightsOf(stop: TripStop, places: Place[]): Place[] {
  const name = stop.name.toLowerCase()
  return places.filter(
    (p) =>
      p.trip_id === stop.trip_id &&
      ((p.city ?? '').toLowerCase() === name || (p.notes ?? '').toLowerCase().includes(`etape : ${name}`)),
  )
}
