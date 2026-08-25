import { haversineKm } from './stats'
import type { TrackPoint } from './types'
import type { Key } from '../i18n/fr'

export type Fix = { lat: number; lng: number; accuracy: number }

export function geolocationAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator
}

/**
 * Position courante. Le navigateur ne donne rien sans HTTPS (localhost est
 * considere comme sur), et l'utilisateur doit accepter l'invite du navigateur,
 * qui n'est pas contournable.
 */
export function currentPosition(timeoutMs = 15000): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!geolocationAvailable()) {
      reject(new GeoError('geo.unsupported'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      (err) => reject(new GeoError(messageFor(err))),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    )
  })
}

/**
 * Erreur qui transporte une cle de traduction plutot qu'un texte : la couche
 * geolocalisation ne connait pas la langue affichee.
 */
export class GeoError extends Error {
  readonly key: Key

  constructor(key: Key) {
    super(key)
    this.key = key
    this.name = 'GeoError'
  }
}

export function messageFor(err: GeolocationPositionError): Key {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return 'geo.denied'
    case err.POSITION_UNAVAILABLE:
      return 'geo.unavailable'
    case err.TIMEOUT:
      return 'geo.timeout'
    default:
      return 'geo.unavailable'
  }
}

/** En dessous de ce seuil, un nouveau point est du bruit GPS, pas un pas. */
const MIN_STEP_KM = 0.008 // 8 metres
const MAX_ACCURACY_M = 60

/**
 * Ajoute un point a une trace si le deplacement est reel. Sans ce filtre, un
 * telephone immobile fabrique des centaines de metres de zigzag et fausse la
 * distance totale.
 */
export function appendPoint(
  points: TrackPoint[],
  fix: Fix & { t: number },
): { points: TrackPoint[]; added: boolean } {
  if (fix.accuracy > MAX_ACCURACY_M && points.length > 0) return { points, added: false }
  const last = points[points.length - 1]
  if (last && haversineKm(last, fix) < MIN_STEP_KM) return { points, added: false }
  return { points: [...points, { t: fix.t, lat: fix.lat, lng: fix.lng }], added: true }
}

export function trackDistanceKm(points: TrackPoint[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += haversineKm(points[i - 1], points[i])
  return total
}

export function formatDuration(fromIso: string | null, toIso: string | null): string {
  if (!fromIso || !toIso) return ''
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const min = Math.round(ms / 60000)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const rest = min % 60
  return rest === 0 ? `${h} h` : `${h} h ${String(rest).padStart(2, '0')}`
}
