import { AVATARS_BUCKET, PHOTOS_BUCKET, supabase } from './supabase'
import { compressImage } from './images'
import type {
  Category,
  NewCategory,
  NewPlace,
  NewTrack,
  NewTrip,
  Photo,
  Place,
  Profile,
  PublicShare,
  SharedPhoto,
  SharedPlace,
  SharedTrip,
  Track,
  Trip,
} from './types'

const SIGNED_URL_TTL = 60 * 60 // 1 h

/* -------------------------------------------------------------------------- */
/* Lieux                                                                      */
/* -------------------------------------------------------------------------- */

export async function fetchPlaces(userId: string): Promise<Place[]> {
  const { data, error } = await supabase
    .from('places')
    .select('*')
    .eq('user_id', userId)
    .order('visit_date', { ascending: false, nullsFirst: false })
  if (error) throw error
  return data ?? []
}

export async function createPlace(place: NewPlace): Promise<Place> {
  const { data, error } = await supabase.from('places').insert(place).select().single()
  if (error) throw error
  return data
}

export async function updatePlace(id: string, patch: Partial<NewPlace>): Promise<Place> {
  const { data, error } = await supabase
    .from('places')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Supprime le lieu, ses lignes photos (cascade en base) et les fichiers
 * correspondants dans le storage. Le storage n'a pas de cascade, il faut
 * lister les chemins AVANT de supprimer la ligne.
 */
export async function deletePlace(place: Place): Promise<void> {
  const photos = await fetchPhotos(place.id)
  const { error } = await supabase.from('places').delete().eq('id', place.id)
  if (error) throw error
  if (photos.length > 0) {
    await supabase.storage.from(PHOTOS_BUCKET).remove(photos.map((p) => p.url))
  }
}

/* -------------------------------------------------------------------------- */
/* Voyages                                                                    */
/* -------------------------------------------------------------------------- */

export async function fetchTrips(userId: string): Promise<Trip[]> {
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .eq('user_id', userId)
    .order('start_date', { ascending: false, nullsFirst: false })
  if (error) throw error
  return data ?? []
}

export async function createTrip(trip: NewTrip): Promise<Trip> {
  const { data, error } = await supabase.from('trips').insert(trip).select().single()
  if (error) throw error
  return data
}

export async function updateTrip(id: string, patch: Partial<NewTrip>): Promise<Trip> {
  const { data, error } = await supabase.from('trips').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

/** Les lieux du voyage ne sont pas supprimes, ils redeviennent isoles. */
export async function deleteTrip(id: string): Promise<void> {
  const { error } = await supabase.from('trips').delete().eq('id', id)
  if (error) throw error
}

export async function assignPlaceToTrip(placeId: string, tripId: string | null): Promise<Place> {
  return updatePlace(placeId, { trip_id: tripId })
}

/* -------------------------------------------------------------------------- */
/* Photos                                                                     */
/* -------------------------------------------------------------------------- */

export async function fetchPhotos(placeId: string): Promise<Photo[]> {
  const { data, error } = await supabase
    .from('photos')
    .select('*')
    .eq('place_id', placeId)
    .order('uploaded_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

/** Toutes les photos du compte, pour la galerie globale. */
export async function fetchAllPhotos(userId: string): Promise<Photo[]> {
  const { data, error } = await supabase
    .from('photos')
    .select('*')
    .eq('user_id', userId)
    .order('uploaded_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function countPhotos(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  if (error) throw error
  return count ?? 0
}

/**
 * Le bucket est prive, chaque affichage passe par une URL signee.
 * L'API accepte une centaine de chemins par appel, on decoupe par lots pour
 * que la galerie globale ne tombe pas en erreur quand elle grossit.
 */
export async function signPhotoUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {}
  const map: Record<string, string> = {}
  const BATCH = 90
  for (let i = 0; i < paths.length; i += BATCH) {
    const slice = paths.slice(i, i + BATCH)
    const { data, error } = await supabase.storage
      .from(PHOTOS_BUCKET)
      .createSignedUrls(slice, SIGNED_URL_TTL)
    if (error) throw error
    for (const item of data ?? []) {
      if (item.signedUrl && item.path) map[item.path] = item.signedUrl
    }
  }
  return map
}

function extensionOf(file: File): string {
  const fromName = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : ''
  if (fromName) return fromName
  return file.type.split('/')[1] ?? 'jpg'
}

export async function uploadPhoto(userId: string, placeId: string, input: File): Promise<Photo> {
  // Compression avant envoi : une photo de telephone brute sature vite le
  // stockage et rend l'ajout interminable en reseau mobile.
  const { file } = await compressImage(input)
  const path = `${userId}/${placeId}/${crypto.randomUUID()}.${extensionOf(file)}`
  const { error: uploadError } = await supabase.storage
    .from(PHOTOS_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false })
  if (uploadError) throw uploadError

  const { data, error } = await supabase
    .from('photos')
    .insert({ place_id: placeId, user_id: userId, url: path })
    .select()
    .single()

  if (error) {
    // La ligne n'a pas ete creee, on ne laisse pas un fichier orphelin
    await supabase.storage.from(PHOTOS_BUCKET).remove([path])
    throw error
  }
  return data
}

export async function deletePhoto(photo: Photo): Promise<void> {
  const { error } = await supabase.from('photos').delete().eq('id', photo.id)
  if (error) throw error
  await supabase.storage.from(PHOTOS_BUCKET).remove([photo.url])
}

/* -------------------------------------------------------------------------- */
/* Profil                                                                     */
/* -------------------------------------------------------------------------- */

export async function uploadAvatar(userId: string, input: File): Promise<Profile> {
  const { file } = await compressImage(input)
  const path = `${userId}/avatar.${extensionOf(file)}`
  const { error: uploadError } = await supabase.storage
    .from(AVATARS_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: true })
  if (uploadError) throw uploadError

  const { data: pub } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(path)
  // Le cache-buster evite d'afficher l'ancienne image apres un remplacement
  const url = `${pub.publicUrl}?v=${Date.now()}`

  const { data, error } = await supabase
    .from('profiles')
    .update({ avatar_url: url })
    .eq('id', userId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateDisplayName(userId: string, displayName: string): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .update({ display_name: displayName })
    .eq('id', userId)
    .select()
    .single()
  if (error) throw error
  return data
}

/* -------------------------------------------------------------------------- */
/* Partage public en lecture seule                                            */
/* -------------------------------------------------------------------------- */

function makeToken(): string {
  // 22 caracteres tires du generateur cryptographique, sans ambiguite visuelle
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(22))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

export async function fetchShare(userId: string): Promise<PublicShare | null> {
  const { data, error } = await supabase
    .from('public_shares')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data
}

/** Cree le partage au premier appel, puis se contente de l'activer. */
export async function enableShare(userId: string): Promise<PublicShare> {
  const existing = await fetchShare(userId)
  if (existing) {
    const { data, error } = await supabase
      .from('public_shares')
      .update({ is_active: true })
      .eq('user_id', userId)
      .select()
      .single()
    if (error) throw error
    return data
  }
  const { data, error } = await supabase
    .from('public_shares')
    .insert({ user_id: userId, token: makeToken(), is_active: true })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function disableShare(userId: string): Promise<void> {
  const { error } = await supabase
    .from('public_shares')
    .update({ is_active: false })
    .eq('user_id', userId)
  if (error) throw error
}

/** Regenere le jeton : l'ancien lien cesse immediatement de fonctionner. */
export async function rotateShare(userId: string): Promise<PublicShare> {
  const { data, error } = await supabase
    .from('public_shares')
    .update({ token: makeToken(), is_active: true })
    .eq('user_id', userId)
    .select()
    .single()
  if (error) throw error
  return data
}

export type SharedData = {
  profile: { display_name: string | null; avatar_url: string | null } | null
  places: SharedPlace[]
  trips: SharedTrip[]
  photos: SharedPhoto[]
}

/**
 * Lecture cote visiteur, sans compte. Les quatre fonctions sont security
 * definer et exigent le jeton, la RLS n'est pas assouplie pour autant.
 */
export async function fetchSharedData(token: string): Promise<SharedData> {
  const [profile, places, trips, photos] = await Promise.all([
    supabase.rpc('shared_profile', { share_token: token }),
    supabase.rpc('shared_places', { share_token: token }),
    supabase.rpc('shared_trips', { share_token: token }),
    supabase.rpc('shared_photos', { share_token: token }),
  ])

  const firstError = profile.error ?? places.error ?? trips.error ?? photos.error
  if (firstError) throw firstError

  return {
    profile: profile.data?.[0] ?? null,
    places: places.data ?? [],
    trips: trips.data ?? [],
    photos: photos.data ?? [],
  }
}

/* -------------------------------------------------------------------------- */
/* Traces GPS                                                                 */
/* -------------------------------------------------------------------------- */

export async function fetchTracks(userId: string): Promise<Track[]> {
  const { data, error } = await supabase
    .from('tracks')
    .select('*')
    .eq('user_id', userId)
    .order('started_at', { ascending: false, nullsFirst: false })
  if (error) throw error
  return data ?? []
}

export async function createTrack(track: NewTrack): Promise<Track> {
  const { data, error } = await supabase.from('tracks').insert(track).select().single()
  if (error) throw error
  return data
}

export async function updateTrack(id: string, patch: Partial<NewTrack>): Promise<Track> {
  const { data, error } = await supabase.from('tracks').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteTrack(id: string): Promise<void> {
  const { error } = await supabase.from('tracks').delete().eq('id', id)
  if (error) throw error
}

/* -------------------------------------------------------------------------- */
/* Categories                                                                 */
/* -------------------------------------------------------------------------- */

/** Proposees en un clic au premier passage, puis librement modifiables. */
export const DEFAULT_CATEGORIES: { name: string; color: string }[] = [
  { name: 'Ville', color: '#c4653d' },
  { name: 'Nature', color: '#7f8f7a' },
  { name: 'Plage', color: '#3f8fa3' },
  { name: 'Musee', color: '#9a6ea8' },
  { name: 'Restaurant', color: '#c9a227' },
  { name: 'Hebergement', color: '#8a7a68' },
]

export async function fetchCategories(userId: string): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('user_id', userId)
    .order('name')
  if (error) throw error
  return data ?? []
}

export async function createCategory(input: NewCategory): Promise<Category> {
  const { data, error } = await supabase.from('categories').insert(input).select().single()
  if (error) throw error
  return data
}

export async function updateCategory(
  id: string,
  patch: Partial<NewCategory>,
): Promise<Category> {
  const { data, error } = await supabase
    .from('categories')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

/** Les lieux ne sont pas supprimes, ils perdent seulement leur categorie. */
export async function deleteCategory(id: string): Promise<void> {
  const { error } = await supabase.from('categories').delete().eq('id', id)
  if (error) throw error
}

export async function seedCategories(userId: string): Promise<Category[]> {
  const rows = DEFAULT_CATEGORIES.map((c) => ({
    user_id: userId,
    name: c.name,
    color: c.color,
    icon: null,
  }))
  const { data, error } = await supabase.from('categories').insert(rows).select()
  if (error) throw error
  return data ?? []
}
