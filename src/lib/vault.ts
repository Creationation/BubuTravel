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

/* Copie locale des donnees du coffre : tout reste lisible sans reseau. */
let owner = ''
/** Les copies locales sont rangees par compte : deux comptes, deux coffres. */
async function resolveOwner() {
  const { data } = await supabase.auth.getSession()
  owner = data.session?.user.id ?? ''
}
function saveLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(`bubutravel:coffre:${owner}:${key}`, JSON.stringify(value))
  } catch {
    // stockage plein ou bloque : on garde au moins l'affichage en ligne
  }
}
export function loadLocal<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`bubutravel:coffre:${owner}:${key}`)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}
export { saveLocal as saveVaultLocal }

export async function fetchVault(): Promise<VaultItem[]> {
  await resolveOwner()
  try {
    const { data, error } = await db().from('vault_items').select('*').order('position').order('created_at')
    if (error) throw error
    const rows = (data ?? []) as unknown as VaultItem[]
    saveLocal('rows', rows)
    return rows
  } catch (err) {
    const cached = loadLocal<VaultItem[]>('rows')
    if (cached) return cached
    throw err
  }
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

/**
 * Garde une copie de tous les fichiers du coffre sur cet appareil. Appelee
 * toute seule a chaque ouverture du coffre en ligne : seuls les fichiers
 * manquants sont telecharges. Renvoie le nombre de fichiers disponibles.
 */
export async function cacheVaultOffline(items: VaultItem[]): Promise<number> {
  if (!('caches' in window)) return 0
  const paths = [...new Set(items.flatMap((i) => i.files))]
  const cache = await caches.open(CACHE)
  const missing: string[] = []
  for (const p of paths) if (!(await cache.match(key(p)))) missing.push(p)
  if (missing.length && navigator.onLine) {
    const urls = await signVaultFiles(missing)
    for (const p of missing) {
      if (!urls[p]) continue
      try {
        const res = await fetch(urls[p])
        if (res.ok) {
          await cache.put(key(p), new Response(await res.blob(), { headers: { 'Content-Type': res.headers.get('content-type') ?? '' } }))
        }
      } catch {
        // reseau coupe en route : on reessaiera a la prochaine ouverture
      }
    }
  }
  let n = 0
  for (const p of paths) if (await cache.match(key(p))) n++
  return n
}

/** Copie locale d'un fichier quelconque (reservations du voyage). */
export async function cacheUrl(id: string, url: () => Promise<string | null>): Promise<boolean> {
  if (!('caches' in window)) return false
  const cache = await caches.open(CACHE)
  if (await cache.match(key(`doc/${id}`))) return true
  if (!navigator.onLine) return false
  try {
    const u = await url()
    if (!u) return false
    const res = await fetch(u)
    if (!res.ok) return false
    await cache.put(key(`doc/${id}`), new Response(await res.blob(), { headers: { 'Content-Type': res.headers.get('content-type') ?? '' } }))
    return true
  } catch {
    return false
  }
}

export async function cachedUrl(id: string): Promise<string | null> {
  if (!('caches' in window)) return null
  const hit = await (await caches.open(CACHE)).match(key(`doc/${id}`))
  return hit ? URL.createObjectURL(await hit.blob()) : null
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
