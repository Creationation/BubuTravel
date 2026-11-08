import { supabase as typed } from './supabase'

// Table absente du schema type genere : acces non type
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase = typed as any

/**
 * Jours « complets » de l'agenda, partages entre les voyageurs (table
 * trip_day_status, migration 028). Si la table n'existe pas encore, les
 * fonctions renvoient null / false et l'appelant garde une copie locale.
 */
export type DayStatus = Record<string, string>

export async function fetchDayStatus(tripId: string): Promise<DayStatus | null> {
  const { data, error } = await supabase.from('trip_day_status').select('day, reason').eq('trip_id', tripId)
  if (error) return null
  const out: DayStatus = {}
  for (const r of data ?? []) out[String(r.day).slice(0, 10)] = r.reason ?? ''
  return out
}

export async function setDayDone(tripId: string, day: string, reason: string): Promise<boolean> {
  const { error } = await supabase.from('trip_day_status').upsert({ trip_id: tripId, day, reason, updated_at: new Date().toISOString() }, { onConflict: 'trip_id,day' })
  return !error
}

export async function clearDayDone(tripId: string, day: string): Promise<boolean> {
  const { error } = await supabase.from('trip_day_status').delete().eq('trip_id', tripId).eq('day', day)
  return !error
}

/** Ecoute les changements faits par l'autre voyageur. */
export function watchDayStatus(tripId: string, onChange: () => void): () => void {
  const ch = supabase
    .channel(`day-status-${tripId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_day_status', filter: `trip_id=eq.${tripId}` }, onChange)
    .subscribe()
  return () => {
    void supabase.removeChannel(ch)
  }
}
