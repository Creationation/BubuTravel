import { runAiJob } from './aiJobs'
import { supabase } from './supabase'
import type { CountryGuide, CountryGuideRow, Json } from './types'

/** Fiches pays d'un voyage (paiement, entree, pratique, check-list). */
export async function fetchGuides(tripId: string): Promise<CountryGuideRow[]> {
  const { data, error } = await supabase.from('country_guides').select('*').eq('trip_id', tripId)
  if (error) throw error
  return (data ?? []) as CountryGuideRow[]
}

export type GuideRequest = {
  country: string
  lang: 'fr' | 'en'
  passport: string
  start_date: string | null
  end_date: string | null
  stops: string[]
  today: string
}

/**
 * Demande la fiche a l'IA (analyseur du PC) puis l'enregistre pour le
 * voyage : les deux voyageurs la voient, sans la redemander.
 */
export async function generateGuide(tripId: string, req: GuideRequest): Promise<CountryGuideRow> {
  const guide = await runAiJob<CountryGuide>('country_guide', req, tripId)
  const { data, error } = await supabase
    .from('country_guides')
    .upsert(
      { trip_id: tripId, country: req.country, guide: guide as unknown as Json, updated_at: new Date().toISOString() },
      { onConflict: 'trip_id,country' },
    )
    .select()
    .single()
  if (error) throw error
  return data as CountryGuideRow
}

/** Pays ajoute a la main (sans etape encore) : une ligne vide suffit. */
export async function addCountry(tripId: string, country: string): Promise<CountryGuideRow> {
  const { data, error } = await supabase
    .from('country_guides')
    .upsert({ trip_id: tripId, country }, { onConflict: 'trip_id,country' })
    .select()
    .single()
  if (error) throw error
  return data as CountryGuideRow
}

/** Drapeau emoji a partir du nom du pays, pour les plus courants du voyage. */
const FLAGS: Record<string, string> = {
  thailande: '🇹🇭',
  thailand: '🇹🇭',
  vietnam: '🇻🇳',
  'viet nam': '🇻🇳',
  cambodge: '🇰🇭',
  cambodia: '🇰🇭',
  laos: '🇱🇦',
  malaisie: '🇲🇾',
  malaysia: '🇲🇾',
  indonesie: '🇮🇩',
  indonesia: '🇮🇩',
  singapour: '🇸🇬',
  singapore: '🇸🇬',
  philippines: '🇵🇭',
  myanmar: '🇲🇲',
  japon: '🇯🇵',
  japan: '🇯🇵',
  autriche: '🇦🇹',
  austria: '🇦🇹',
  france: '🇫🇷',
}

export function flagOf(country: string): string {
  const key = country
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
  return FLAGS[key] ?? '🌏'
}
