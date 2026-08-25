import type { Place } from './types'
import type { Key } from '../i18n/fr'

type Translate = (key: Key, params?: Record<string, string | number>) => string

const EARTH_RADIUS_KM = 6371

/** Distance a vol d'oiseau entre deux points, formule de haversine. */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

/**
 * Kilometres approximatifs : somme des sauts entre lieux consecutifs, dans
 * l'ordre chronologique. Les lieux sans date sont ignores, sinon ils
 * inventeraient des trajets. C'est une estimation a vol d'oiseau, pas un
 * itineraire reel.
 */
export function totalDistanceKm(places: Place[]): number {
  const dated = places
    .filter((p) => p.visit_date)
    .sort((a, b) => a.visit_date!.localeCompare(b.visit_date!))
  let total = 0
  for (let i = 1; i < dated.length; i++) total += haversineKm(dated[i - 1], dated[i])
  return Math.round(total)
}

export type Stats = {
  countries: number
  cities: number
  places: number
  photos: number
  km: number
  firstYear: number | null
}

export function buildStats(places: Place[], photoCount: number): Stats {
  const countries = new Set(places.map((p) => p.country).filter(Boolean))
  const cities = new Set(
    places.map((p) => `${(p.city || p.name).toLowerCase()}|${p.country.toLowerCase()}`),
  )
  const years = places
    .filter((p) => p.visit_date)
    .map((p) => Number(p.visit_date!.slice(0, 4)))
    .filter((y) => Number.isFinite(y))

  return {
    countries: countries.size,
    cities: places.length === 0 ? 0 : cities.size,
    places: places.length,
    photos: photoCount,
    km: totalDistanceKm(places),
    firstYear: years.length > 0 ? Math.min(...years) : null,
  }
}

/** Accord au pluriel, avec la forme irreguliere passee au besoin. */
export function plural(n: number, one: string, many?: string): string {
  return `${n} ${n > 1 ? (many ?? `${one}s`) : one}`
}

export function formatKm(km: number): string {
  if (km >= 1000) return `${(km / 1000).toFixed(km >= 10000 ? 0 : 1).replace('.', ',')} k`
  return String(km)
}

export function formatDate(
  iso: string | null,
  opts?: Intl.DateTimeFormatOptions,
  locale = 'fr-FR',
): string {
  if (!iso) return ''
  return new Date(`${iso}T00:00:00`).toLocaleDateString(
    locale,
    opts ?? { day: 'numeric', month: 'long', year: 'numeric' },
  )
}

/** "12 au 20 mars 2026", ou une seule date si les deux sont identiques. */
export function formatRange(
  start: string | null,
  end: string | null,
  t: Translate,
  locale = 'fr-FR',
): string {
  if (!start && !end) return t('trips.datesUnset')
  if (start && !end) return t('trips.rangeFrom', { date: formatDate(start, undefined, locale) })
  if (!start && end) return t('trips.rangeUntil', { date: formatDate(end, undefined, locale) })
  if (start === end) return formatDate(start, undefined, locale)

  const s = new Date(`${start}T00:00:00`)
  const e = new Date(`${end}T00:00:00`)
  const sameYear = s.getFullYear() === e.getFullYear()
  const sameMonth = sameYear && s.getMonth() === e.getMonth()

  // Meme mois : seul le quantieme change, inutile de le repeter en entier
  if (sameMonth) {
    return t('trips.rangeTo', {
      start: String(s.getDate()),
      end: formatDate(end, undefined, locale),
    })
  }
  if (sameYear) {
    return t('trips.rangeTo', {
      start: s.toLocaleDateString(locale, { day: 'numeric', month: 'long' }),
      end: formatDate(end, undefined, locale),
    })
  }
  return t('trips.rangeTo', {
    start: formatDate(start, undefined, locale),
    end: formatDate(end, undefined, locale),
  })
}

/** Regroupe des lieux par annee, du plus recent au plus ancien. */
export function groupByYear<T extends { visit_date: string | null }>(
  items: T[],
): { year: string; items: T[] }[] {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const year = item.visit_date ? item.visit_date.slice(0, 4) : 'Sans date'
    const list = map.get(year)
    if (list) list.push(item)
    else map.set(year, [item])
  }
  return [...map.entries()]
    .sort((a, b) => {
      if (a[0] === 'Sans date') return 1
      if (b[0] === 'Sans date') return -1
      return b[0].localeCompare(a[0])
    })
    .map(([year, items]) => ({ year, items }))
}
