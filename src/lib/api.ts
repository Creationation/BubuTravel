import { AVATARS_BUCKET, PHOTOS_BUCKET, supabase } from './supabase'
import type { NewPlace, Photo, Place, Profile } from './types'

const SIGNED_URL_TTL = 60 * 60 // 1 h

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

export async function fetchPhotos(placeId: string): Promise<Photo[]> {
  const { data, error } = await supabase
    .from('photos')
    .select('*')
    .eq('place_id', placeId)
    .order('uploaded_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

/** Le bucket est prive, chaque affichage passe par une URL signee. */
export async function signPhotoUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {}
  const { data, error } = await supabase.storage
    .from(PHOTOS_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL)
  if (error) throw error
  const map: Record<string, string> = {}
  for (const item of data ?? []) {
    if (item.signedUrl && item.path) map[item.path] = item.signedUrl
  }
  return map
}

function extensionOf(file: File): string {
  const fromName = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : ''
  if (fromName) return fromName
  return file.type.split('/')[1] ?? 'jpg'
}

export async function uploadPhoto(userId: string, placeId: string, file: File): Promise<Photo> {
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

export async function uploadAvatar(userId: string, file: File): Promise<Profile> {
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
