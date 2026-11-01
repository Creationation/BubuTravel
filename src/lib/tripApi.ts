import { supabase } from './supabase'
import type {
  NewTripDocument,
  NewTripStop,
  NewTripTodo,
  TripDocument,
  TripPerson,
  TripStop,
  TripTodo,
} from './types'

/**
 * Tout ce qui vit DANS un voyage : etapes, a faire, documents, personnes.
 * Ces tables sont protegees par is_trip_member() cote base, donc les deux
 * voyageurs d'un voyage partage lisent et ecrivent les memes lignes.
 */

export const DOCS_BUCKET = 'trip-docs'
const DOC_URL_TTL = 60 * 10 // 10 min : un passeport ne doit pas trainer en lien ouvert

/* ------------------------------------------------------------------ etapes */

export async function fetchStops(tripId: string): Promise<TripStop[]> {
  const { data, error } = await supabase
    .from('trip_stops')
    .select('*')
    .eq('trip_id', tripId)
    .order('position', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function createStop(input: NewTripStop): Promise<TripStop> {
  const { data, error } = await supabase.from('trip_stops').insert(input).select().single()
  if (error) throw error
  return data
}

export async function updateStop(id: string, patch: Partial<NewTripStop>): Promise<TripStop> {
  const { data, error } = await supabase.from('trip_stops').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteStop(id: string): Promise<void> {
  const { error } = await supabase.from('trip_stops').delete().eq('id', id)
  if (error) throw error
}

/* ----------------------------------------------------------------- a faire */

export async function fetchTodos(tripId: string): Promise<TripTodo[]> {
  const { data, error } = await supabase
    .from('trip_todos')
    .select('*')
    .eq('trip_id', tripId)
    .order('position', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function createTodo(
  input: Partial<NewTripTodo> & Pick<NewTripTodo, 'trip_id' | 'title'>,
): Promise<TripTodo> {
  const { data, error } = await supabase.from('trip_todos').insert(input).select().single()
  if (error) throw error
  return data
}

export async function updateTodo(id: string, patch: Partial<NewTripTodo>): Promise<TripTodo> {
  const { data, error } = await supabase.from('trip_todos').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteTodo(id: string): Promise<void> {
  const { error } = await supabase.from('trip_todos').delete().eq('id', id)
  if (error) throw error
}

/* --------------------------------------------------------------- documents */

export async function fetchDocuments(tripId: string): Promise<TripDocument[]> {
  const { data, error } = await supabase
    .from('trip_documents')
    .select('*')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

/** Nom de fichier sur : pas d'accents ni d'espaces dans une cle de stockage. */
function safeName(name: string): string {
  const cleaned = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(-80)
  return cleaned || 'document'
}

export async function createDocument(
  input: Partial<NewTripDocument> & Pick<NewTripDocument, 'trip_id' | 'title' | 'kind'>,
  file: File | null,
): Promise<TripDocument> {
  let path: string | null = null
  if (file) {
    // Le premier dossier est l'identifiant du voyage : c'est lui que la
    // policy du bucket verifie pour ouvrir le fichier aux deux voyageurs.
    path = `${input.trip_id}/${crypto.randomUUID()}-${safeName(file.name)}`
    const { error: upErr } = await supabase.storage
      .from(DOCS_BUCKET)
      .upload(path, file, { contentType: file.type || undefined, upsert: false })
    if (upErr) throw upErr
  }

  const { data, error } = await supabase
    .from('trip_documents')
    .insert({
      ...input,
      path,
      file_name: file?.name ?? null,
      mime: file?.type || null,
      size_bytes: file?.size ?? null,
    })
    .select()
    .single()

  if (error) {
    if (path) await supabase.storage.from(DOCS_BUCKET).remove([path])
    throw error
  }
  return data
}

export async function updateDocument(
  id: string,
  patch: Partial<NewTripDocument>,
): Promise<TripDocument> {
  const { data, error } = await supabase
    .from('trip_documents')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

/** Remplace le fichier d'un document : nouveau fichier envoye, ancien supprime. */
export async function replaceDocumentFile(doc: TripDocument, file: File): Promise<TripDocument> {
  const path = `${doc.trip_id}/${crypto.randomUUID()}-${safeName(file.name)}`
  const { error: upErr } = await supabase.storage
    .from(DOCS_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false })
  if (upErr) throw upErr
  const updated = await updateDocument(doc.id, {
    path,
    file_name: file.name,
    mime: file.type || null,
    size_bytes: file.size,
  })
  if (doc.path) await supabase.storage.from(DOCS_BUCKET).remove([doc.path])
  await forgetOffline(doc.id)
  return updated
}

export async function deleteDocument(doc: TripDocument): Promise<void> {
  const { error } = await supabase.from('trip_documents').delete().eq('id', doc.id)
  if (error) throw error
  if (doc.path) await supabase.storage.from(DOCS_BUCKET).remove([doc.path])
  await forgetOffline(doc.id)
}

export async function signDocumentUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(DOCS_BUCKET).createSignedUrl(path, DOC_URL_TTL)
  if (error) throw error
  return data.signedUrl
}

/* ------------------------------------------------------- hors ligne (cache) */

/*
 * A l'aeroport ou a la frontiere, le reseau manque souvent au pire moment.
 * Un document « garde hors ligne » est copie dans le Cache du navigateur,
 * sur CET appareil seulement, et s'ouvre ensuite sans connexion.
 */
const OFFLINE_CACHE = 'bubutravel-documents'
const offlineKey = (id: string) => `/hors-ligne/document/${id}`

function cachesAvailable(): boolean {
  return typeof window !== 'undefined' && 'caches' in window
}

export async function keepOffline(doc: TripDocument): Promise<void> {
  if (!doc.path || !cachesAvailable()) return
  const url = await signDocumentUrl(doc.path)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Telechargement impossible (${res.status})`)
  const blob = await res.blob()
  const cache = await caches.open(OFFLINE_CACHE)
  await cache.put(
    offlineKey(doc.id),
    new Response(blob, { headers: { 'Content-Type': doc.mime || blob.type || 'application/octet-stream' } }),
  )
}

export async function forgetOffline(id: string): Promise<void> {
  if (!cachesAvailable()) return
  try {
    const cache = await caches.open(OFFLINE_CACHE)
    await cache.delete(offlineKey(id))
  } catch {
    // Rien de grave : le cache est une commodite
  }
}

export async function offlineIds(): Promise<Set<string>> {
  if (!cachesAvailable()) return new Set()
  try {
    const cache = await caches.open(OFFLINE_CACHE)
    const keys = await cache.keys()
    return new Set(keys.map((r) => new URL(r.url).pathname.split('/').pop() ?? ''))
  } catch {
    return new Set()
  }
}

/**
 * Ouvre un document : la copie hors ligne si elle existe, sinon un lien signe
 * de quelques minutes. Renvoie une URL affichable dans un nouvel onglet.
 */
export async function openDocumentUrl(doc: TripDocument): Promise<string | null> {
  if (cachesAvailable()) {
    try {
      const cache = await caches.open(OFFLINE_CACHE)
      const hit = await cache.match(offlineKey(doc.id))
      if (hit) return URL.createObjectURL(await hit.blob())
    } catch {
      // On retombe sur le lien signe
    }
  }
  if (!doc.path) return null
  return signDocumentUrl(doc.path)
}

/* --------------------------------------------------------------- personnes */

export async function fetchTripPeople(tripId: string): Promise<TripPerson[]> {
  const { data, error } = await supabase.rpc('trip_people', { p_trip: tripId })
  if (error) throw error
  return data ?? []
}

export async function inviteToTrip(tripId: string, email: string): Promise<string> {
  const { data, error } = await supabase.rpc('invite_trip_member', { p_trip: tripId, p_email: email })
  if (error) throw error
  return data
}

export async function removeFromTrip(tripId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('trip_members')
    .delete()
    .eq('trip_id', tripId)
    .eq('user_id', userId)
  if (error) throw error
}
