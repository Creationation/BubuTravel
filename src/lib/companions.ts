import { supabase } from './supabase'

export type Companion = { user_id: string; display_name: string; avatar_url: string | null }

/** Les personnes avec qui on partage deja au moins un voyage. */
export async function fetchCompanions(): Promise<Companion[]> {
  const { data, error } = await supabase.rpc('my_companions' as never)
  if (error) throw error
  return (data ?? []) as Companion[]
}

/** Ajoute une compagne / un compagnon de voyage en un tap (sans email). */
export async function addCompanion(tripId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('add_trip_companion' as never, { p_trip: tripId, p_user: userId } as never)
  if (error) throw error
}
