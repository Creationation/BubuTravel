import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { LinkIdea } from './types'

/**
 * Idees venues des reseaux : un lien colle devient une ligne `pending`.
 * L'analyseur (programme Python sur le PC de la maison, plus tard un VPS)
 * la traite et ecrit le resultat. L'app suit tout en temps reel.
 */

export type Platform = 'tiktok' | 'instagram' | 'youtube' | 'maps' | 'web'

export function detectPlatform(url: string): Platform {
  const u = url.toLowerCase()
  if (u.includes('tiktok.com')) return 'tiktok'
  if (u.includes('instagram.com')) return 'instagram'
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube'
  if (u.includes('maps.app.goo.gl') || u.includes('google.') && u.includes('/maps') || u.includes('goo.gl/maps'))
    return 'maps'
  return 'web'
}

/** Extrait une URL d'un texte partage (« Regarde ca ! https://vm.tiktok.com/... »). */
export function extractUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"']+/i)
  return match ? match[0].replace(/[).,;]+$/, '') : null
}

/**
 * Voyage en cours ou a venir le plus proche (les siens et ceux partages).
 * Une idee envoyee hors d'un voyage y est rattachee, sinon le lieu cree par
 * l'analyse reste prive a la personne qui l'a envoyee et l'autre ne le voit pas.
 */
async function currentTripId(): Promise<string | null> {
  const today = new Date().toISOString().slice(0, 10)
  const { data } = await supabase
    .from('trips')
    .select('id')
    .or(`end_date.is.null,end_date.gte.${today}`)
    .order('start_date', { ascending: true, nullsFirst: false })
    .limit(1)
  return data?.[0]?.id ?? null
}

export async function addIdea(url: string, note: string | null, tripId: string | null): Promise<LinkIdea> {
  const trip = tripId ?? (await currentTripId().catch(() => null))
  const { data, error } = await supabase
    .from('link_ideas')
    .insert({ url, note, trip_id: trip, platform: detectPlatform(url) })
    .select()
    .single()
  if (error) throw error
  return data as LinkIdea
}

export async function updateIdea(id: string, patch: Partial<Pick<LinkIdea, 'trip_id' | 'status' | 'place_id' | 'note' | 'attempts' | 'error'>>) {
  const { error } = await supabase.from('link_ideas').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteIdea(id: string) {
  const { error } = await supabase.from('link_ideas').delete().eq('id', id)
  if (error) throw error
}

/** Relance une analyse en echec. */
export async function retryIdea(id: string) {
  await updateIdea(id, { status: 'pending', error: null })
}

/**
 * Les idees visibles : toutes les miennes, et celles des voyages partages.
 * `tripId` filtre sur un voyage ; `null` = la wishlist (sans voyage).
 */
export function useIdeas(scope: { tripId?: string | null } = {}) {
  const [ideas, setIdeas] = useState<LinkIdea[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    // Les idees deja posees sur la carte (archived) restent visibles : regroupees par jour d'envoi
    let query = supabase.from('link_ideas').select('*').order('created_at', { ascending: false }).limit(1000)
    if (scope.tripId !== undefined) {
      query = scope.tripId === null ? query.is('trip_id', null) : query.eq('trip_id', scope.tripId)
    }
    const { data, error: err } = await query
    if (err) setError(err.message)
    else {
      setIdeas((data ?? []) as LinkIdea[])
      setError(null)
    }
    setLoading(false)
  }, [scope.tripId])

  useEffect(() => {
    void reload()
    const channel = supabase
      .channel(`ideas-${scope.tripId ?? 'all'}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'link_ideas' }, () => void reload())
      .subscribe()
    // Filet de securite si le temps reel ne passe pas : on relit tant qu'une
    // analyse est en cours.
    const poll = window.setInterval(() => void reload(), 15000)
    return () => {
      window.clearInterval(poll)
      void supabase.removeChannel(channel)
    }
  }, [reload, scope.tripId])

  return { ideas, loading, error, reload, setIdeas }
}

/** Regroupe les idees par jour d'envoi (heure locale), le plus recent en haut. */
export function groupIdeasByDay(ideas: LinkIdea[]): { day: string; ideas: LinkIdea[] }[] {
  const map = new Map<string, LinkIdea[]>()
  for (const idea of ideas) {
    const d = new Date(idea.created_at)
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const list = map.get(day)
    if (list) list.push(idea)
    else map.set(day, [idea])
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, list]) => ({ day, ideas: list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1)) }))
}

/** L'analyseur a-t-il donne signe de vie dans les 2 dernieres minutes ? */
export function useAnalyzerOnline(): boolean | null {
  const [online, setOnline] = useState<boolean | null>(null)
  useEffect(() => {
    let active = true
    async function check() {
      const { data } = await supabase.from('analyzer_status').select('last_seen').order('last_seen', { ascending: false }).limit(1)
      if (!active) return
      const last = data?.[0]?.last_seen
      setOnline(Boolean(last && Date.now() - new Date(last).getTime() < 120_000))
    }
    void check()
    const timer = window.setInterval(check, 30_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])
  return online
}
