/**
 * Geocodage via Nominatim (OpenStreetMap). Gratuit, sans cle ni compte.
 * Regle d'usage imposee par OSM : 1 requete par seconde maximum et un
 * identifiant d'application. Le navigateur interdit de fixer User-Agent,
 * le Referer envoye automatiquement joue ce role, et on ajoute email=
 * pour rester joignable. Les appels sont serialises plus bas.
 */

const BASE = 'https://nominatim.openstreetmap.org'
const MIN_INTERVAL_MS = 1100

let lastCall = 0

async function throttle() {
  const wait = lastCall + MIN_INTERVAL_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastCall = Date.now()
}

type NominatimPlace = {
  place_id: number
  lat: string
  lon: string
  display_name: string
  name?: string
  address?: Record<string, string>
}

export type GeoResult = {
  id: string
  label: string
  name: string
  country: string
  city: string
  lat: number
  lng: number
}

function toResult(p: NominatimPlace): GeoResult {
  const country = p.address?.country ?? ''
  const city =
    p.address?.city ||
    p.address?.town ||
    p.address?.village ||
    p.address?.municipality ||
    p.address?.county ||
    ''
  const name =
    p.name ||
    p.address?.city ||
    p.address?.town ||
    p.address?.village ||
    p.address?.municipality ||
    p.address?.county ||
    p.display_name.split(',')[0].trim()
  return {
    id: String(p.place_id),
    label: p.display_name,
    name,
    country,
    city,
    lat: Number(p.lat),
    lng: Number(p.lon),
  }
}

/** Recherche libre : "Vienne, Autriche", "Tour Eiffel", "Kyoto"... */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<GeoResult[]> {
  const q = query.trim()
  if (q.length < 3) return []
  await throttle()
  const params = new URLSearchParams({
    q,
    format: 'jsonv2',
    addressdetails: '1',
    limit: '6',
    'accept-language': 'fr',
  })
  const res = await fetch(`${BASE}/search?${params}`, { signal })
  if (!res.ok) throw new Error(`Recherche indisponible (${res.status})`)
  const data = (await res.json()) as NominatimPlace[]
  return data.map(toResult)
}

/** Coordonnees vers nom et pays, utilise apres un clic sur la carte. */
export async function reverseGeocode(lat: number, lng: number): Promise<GeoResult | null> {
  await throttle()
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lng),
    format: 'jsonv2',
    addressdetails: '1',
    zoom: '12',
    'accept-language': 'fr',
  })
  const res = await fetch(`${BASE}/reverse?${params}`)
  if (!res.ok) return null
  const data = (await res.json()) as NominatimPlace & { error?: string }
  if (data.error || !data.lat) return null
  // On garde les coordonnees cliquees, pas celles du centroide renvoye
  return { ...toResult(data), lat, lng }
}
