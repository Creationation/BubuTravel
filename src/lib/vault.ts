import { supabase } from './supabase'
import { compressImage } from './images'

/**
 * Coffre personnel : copie de secours des papiers, cartes, numeros et
 * billets, en cas de perte ou de vol. Prive par defaut, partageable avec les
 * compagnons de voyage, protege par un code a 5 chiffres.
 */

export type VaultKind = 'identity' | 'card' | 'contact' | 'insurance' | 'ticket' | 'other'

export type VaultItem = {
  id: string
  user_id: string
  kind: VaultKind
  title: string
  holder: string | null
  number: string | null
  expires: string | null
  phone: string | null
  email: string | null
  url: string | null
  notes: string | null
  files: string[]
  shared: boolean
  position: number
  created_at: string
}

export type VaultInput = Omit<VaultItem, 'id' | 'user_id' | 'created_at' | 'files' | 'position'>

const BUCKET = 'vault'
const db = () => supabase as unknown as { from: (t: string) => ReturnType<typeof supabase.from> }

export async function fetchVault(): Promise<VaultItem[]> {
  const { data, error } = await db().from('vault_items').select('*').order('position').order('created_at')
  if (error) throw error
  return (data ?? []) as unknown as VaultItem[]
}

async function uploadFiles(userId: string, files: File[]): Promise<string[]> {
  const paths: string[] = []
  for (const input of files) {
    // Les photos sont compressees (lisibles, legeres) ; les PDF restent tels quels
    const file = input.type.startsWith('image/') ? (await compressImage(input)).file : input
    const ext = (file.name.split('.').pop() || (file.type.split('/')[1] ?? 'bin')).toLowerCase()
    const path = `${userId}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined })
    if (error) throw error
    paths.push(path)
  }
  return paths
}

export async function saveVaultItem(
  userId: string,
  input: VaultInput,
  newFiles: File[],
  existing?: VaultItem,
  removed: string[] = [],
): Promise<VaultItem> {
  const added = await uploadFiles(userId, newFiles)
  const files = [...(existing?.files ?? []).filter((f) => !removed.includes(f)), ...added]
  const row = { ...input, files }
  const q = existing
    ? db().from('vault_items').update(row as never).eq('id', existing.id)
    : db().from('vault_items').insert(row as never)
  const { data, error } = await q.select().single()
  if (error) throw error
  if (removed.length) await supabase.storage.from(BUCKET).remove(removed)
  return data as unknown as VaultItem
}

export async function deleteVaultItem(item: VaultItem): Promise<void> {
  const { error } = await db().from('vault_items').delete().eq('id', item.id)
  if (error) throw error
  if (item.files.length) await supabase.storage.from(BUCKET).remove(item.files)
}

export async function signVaultFiles(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {}
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 60 * 15)
  if (error) throw error
  const out: Record<string, string> = {}
  for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl
  return out
}

/* ---------------------------------------------------------------- hors ligne */

const CACHE = 'bubutravel-coffre'
const key = (path: string) => `/hors-ligne/coffre/${path}`

/** Garde une copie de tous les fichiers du coffre sur cet appareil. */
export async function cacheVaultOffline(items: VaultItem[]): Promise<number> {
  if (!('caches' in window)) return 0
  const paths = items.flatMap((i) => i.files)
  const urls = await signVaultFiles(paths)
  const cache = await caches.open(CACHE)
  let n = 0
  for (const p of paths) {
    if (!urls[p]) continue
    const res = await fetch(urls[p])
    if (res.ok) {
      await cache.put(key(p), new Response(await res.blob(), { headers: { 'Content-Type': res.headers.get('content-type') ?? '' } }))
      n++
    }
  }
  return n
}

/** URL affichable : copie locale si elle existe (hors reseau), sinon lien signe. */
export async function vaultFileUrls(paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  if ('caches' in window) {
    try {
      const cache = await caches.open(CACHE)
      for (const p of paths) {
        const hit = await cache.match(key(p))
        if (hit) out[p] = URL.createObjectURL(await hit.blob())
      }
    } catch {
      // pas de cache : liens signes
    }
  }
  const missing = paths.filter((p) => !out[p])
  if (missing.length && navigator.onLine) Object.assign(out, await signVaultFiles(missing).catch(() => ({})))
  return out
}

/* --------------------------------------------------------------------- code */

/**
 * Code a 5 chiffres. On garde seulement une empreinte PBKDF2 salee (en base,
 * pour tous les appareils, et en local pour deverrouiller hors ligne).
 */
const LOCAL = 'bubutravel:vault-pin'

async function digest(pin: string, salt: string): Promise<string> {
  const enc = new TextEncoder()
  const keyMat = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 150_000, hash: 'SHA-256' },
    keyMat,
    256,
  )
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

type PinRecord = { salt: string; hash: string }

export async function loadPin(): Promise<PinRecord | null> {
  try {
    const { data } = await db().from('vault_pins').select('salt, hash').maybeSingle()
    if (data) {
      localStorage.setItem(LOCAL, JSON.stringify(data))
      return data as unknown as PinRecord
    }
  } catch {
    // hors ligne : copie locale
  }
  try {
    const raw = localStorage.getItem(LOCAL)
    return raw ? (JSON.parse(raw) as PinRecord) : null
  } catch {
    return null
  }
}

export async function setPin(pin: string): Promise<void> {
  const salt = crypto.randomUUID()
  const hash = await digest(pin, salt)
  const { error } = await db()
    .from('vault_pins')
    .upsert({ salt, hash, updated_at: new Date().toISOString() } as never, { onConflict: 'user_id' })
  if (error) throw error
  localStorage.setItem(LOCAL, JSON.stringify({ salt, hash }))
}

export async function checkPin(pin: string, record: PinRecord): Promise<boolean> {
  return (await digest(pin, record.salt)) === record.hash
}
