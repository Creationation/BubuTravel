/**
 * Verifie que la base contient bien TOUT ce dont l'app a besoin.
 *
 * Pourquoi ce script existe : l'app a plusieurs fois affiche « colonne
 * introuvable » parce qu'une migration n'avait pas ete executee. Le probleme
 * n'etait pas le SQL, c'est qu'aucun garde-fou ne reliait le code au schema.
 * Ici, la liste ci-dessous est la source de verite : si le code a besoin
 * d'une colonne, elle doit y figurer, et le script dit tout de suite ce qui
 * manque et quoi executer.
 *
 * Lancer avec : node scripts/check-schema.mjs
 * Lit VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY dans .env.local.
 */
import { readFileSync } from 'node:fs'

/** Ce que le code attend, table par table. */
const EXPECTED = {
  profiles: ['id', 'display_name', 'avatar_url', 'lang', 'created_at'],
  places: [
    'id', 'user_id', 'trip_id', 'category_id', 'name', 'country', 'city',
    'lat', 'lng', 'visit_date', 'notes', 'status', 'planned_order',
    'cost', 'currency', 'price_level', 'promo_code', 'promo_note',
    'promo_until', 'rating', 'review', 'created_at',
  ],
  photos: ['id', 'place_id', 'user_id', 'url', 'uploaded_at'],
  trips: [
    'id', 'user_id', 'title', 'start_date', 'end_date', 'cover_url',
    'notes', 'status', 'checklist', 'created_at',
  ],
  tracks: [
    'id', 'user_id', 'trip_id', 'name', 'points', 'distance_km',
    'started_at', 'ended_at', 'notes', 'created_at',
  ],
  categories: ['id', 'user_id', 'name', 'color', 'icon', 'created_at'],
  public_shares: ['user_id', 'token', 'is_active', 'created_at'],
  events: [
    'id', 'user_id', 'place_id', 'trip_id', 'category_id', 'title',
    'description', 'kind', 'organizer', 'url', 'starts_at', 'ends_at',
    'all_day', 'recurrence', 'recurrence_until', 'price', 'currency',
    'is_free', 'booking_note', 'venue', 'lat', 'lng', 'created_at',
  ],
}

/** Fonctions appelables sans compte, pour la page de partage. */
const EXPECTED_RPC = [
  'shared_profile', 'shared_places', 'shared_trips',
  'shared_photos', 'shared_tracks', 'shared_categories', 'shared_events',
]

function readEnv() {
  const raw = readFileSync('.env.local', 'utf8')
  const get = (key) => raw.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim()
  const url = get('VITE_SUPABASE_URL')
  const key = get('VITE_SUPABASE_ANON_KEY')
  if (!url || !key) throw new Error('VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY manque dans .env.local')
  return { url, key }
}

const { url, key } = readEnv()
const headers = { apikey: key, Authorization: `Bearer ${key}` }

let missing = 0

for (const [table, columns] of Object.entries(EXPECTED)) {
  // Une seule requete par table : on demande toutes les colonnes d'un coup.
  // PostgREST refuse la requete entiere des qu'une colonne manque, on
  // retombe alors sur un test colonne par colonne pour nommer la coupable.
  const res = await fetch(`${url}/rest/v1/${table}?select=${columns.join(',')}&limit=1`, { headers })

  if (res.ok) {
    console.log(`  ${table} : ${columns.length} colonnes OK`)
    continue
  }

  const body = await res.json().catch(() => ({}))
  if (body.code === 'PGRST205' || res.status === 404) {
    console.log(`  ${table} : TABLE ABSENTE`)
    missing++
    continue
  }

  const absent = []
  for (const column of columns) {
    const one = await fetch(`${url}/rest/v1/${table}?select=${column}&limit=1`, { headers })
    if (!one.ok) absent.push(column)
  }
  console.log(`  ${table} : colonnes absentes -> ${absent.join(', ') || body.message}`)
  missing += absent.length || 1
}

console.log('')
for (const fn of EXPECTED_RPC) {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ share_token: 'verification' }),
  })
  if (res.ok) {
    console.log(`  ${fn}() OK`)
  } else {
    console.log(`  ${fn}() ABSENTE`)
    missing++
  }
}

console.log('')
if (missing === 0) {
  console.log('Le schema contient tout ce dont l app a besoin.')
} else {
  console.log(`${missing} element(s) manquant(s).`)
  console.log('Collez supabase/schema_complet.sql dans le SQL Editor et executez-le.')
  process.exitCode = 1
}
