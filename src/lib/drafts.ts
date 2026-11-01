import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

/**
 * Brouillons : ce qui est commence et pas fini se garde tout seul.
 *
 * Deux niveaux : le navigateur (instantane, marche hors ligne) et Supabase
 * (on le retrouve sur l'autre appareil, et dans le tiroir « Brouillons »).
 * L'ecriture serveur est regroupee : une seconde apres la derniere frappe.
 */

export type DraftKind = 'assistant' | 'stop' | 'document' | 'idea' | 'todo'

export type DraftRow = {
  id: string
  user_id: string
  key: string
  kind: DraftKind
  trip_id: string | null
  title: string | null
  resume_url: string | null
  payload: unknown
  remind_at: string | null
  updated_at: string
}

const LOCAL_PREFIX = 'bubutravel:draft:'
const listeners = new Set<() => void>()

/** Le tiroir s'abonne pour se rafraichir quand un brouillon change. */
export function onDraftsChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function emit() {
  for (const fn of listeners) fn()
}

function readLocal<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}
function writeLocal(key: string, value: unknown) {
  try {
    if (value === null) window.localStorage.removeItem(LOCAL_PREFIX + key)
    else window.localStorage.setItem(LOCAL_PREFIX + key, JSON.stringify(value))
  } catch {
    // Stockage plein ou bloque : le serveur reste la reference
  }
}

export async function fetchDrafts(): Promise<DraftRow[]> {
  const { data, error } = await supabase
    .from('drafts')
    .select('*')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as DraftRow[]
}

export async function deleteDraft(key: string): Promise<void> {
  writeLocal(key, null)
  await supabase.from('drafts').delete().eq('key', key)
  emit()
}

export async function setDraftReminder(key: string, remindAt: string | null): Promise<void> {
  await supabase.from('drafts').update({ remind_at: remindAt }).eq('key', key)
  emit()
}

/**
 * Etat de formulaire qui survit a la fermeture de l'app.
 * `isEmpty` dit quand il n'y a rien a garder (champ vide) : le brouillon est
 * alors efface au lieu d'encombrer le tiroir.
 */
export function useDraft<T>({
  key,
  kind,
  tripId = null,
  title,
  initial,
  isEmpty,
}: {
  key: string
  kind: DraftKind
  tripId?: string | null
  title: string
  initial: T
  isEmpty: (value: T) => boolean
}) {
  const [value, setValue] = useState<T>(() => readLocal<T>(key) ?? initial)
  const timer = useRef<number | undefined>(undefined)
  const meta = useRef({ kind, tripId, title, isEmpty })
  meta.current = { kind, tripId, title, isEmpty }

  // Un brouillon ecrit sur l'autre appareil prend le relais s'il est absent ici
  useEffect(() => {
    if (readLocal(key)) return
    let active = true
    void supabase
      .from('drafts')
      .select('payload')
      .eq('key', key)
      .maybeSingle()
      .then(({ data }) => {
        if (active && data?.payload) setValue(data.payload as T)
      })
    return () => {
      active = false
    }
  }, [key])

  const set = useCallback(
    (next: T) => {
      setValue(next)
      const empty = meta.current.isEmpty(next)
      writeLocal(key, empty ? null : next)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(async () => {
        try {
          if (empty) {
            await supabase.from('drafts').delete().eq('key', key)
          } else {
            await supabase.from('drafts').upsert(
              {
                key,
                kind: meta.current.kind,
                trip_id: meta.current.tripId,
                title: meta.current.title,
                resume_url: window.location.pathname + window.location.search,
                payload: next as never,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'user_id,key' },
            )
          }
          emit()
        } catch {
          // Hors ligne : la copie locale suffit, le serveur suivra
        }
      }, 1000)
    },
    [key],
  )

  const clear = useCallback(() => {
    window.clearTimeout(timer.current)
    setValue(initial)
    void deleteDraft(key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { value, set, clear }
}
