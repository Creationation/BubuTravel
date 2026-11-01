import { addDaysIso } from './tripDates'
import type { Place, TripStop } from './types'

/**
 * Programme du voyage : placer une chose a faire un jour donne, a une heure,
 * et reperer ce qui coince (chevauchement, journee trop pleine, pas dans la
 * bonne ville ce jour-la).
 */

export const DAY_START = 9 * 60
export const DAY_LIMIT = 9 * 60 // au-dela de 9 h d'activites, la journee est trop pleine

/** « 2 h », « 1h30 », « 45 min », « demi-journee », « journee » -> minutes */
export function parseDuration(text: string | null | undefined): number {
  const s = (text ?? '').toLowerCase()
  if (!s) return 90
  if (/journ[ée]e enti[èe]re|full day|toute la journ/.test(s)) return 8 * 60
  if (/demi[- ]journ|half[- ]day/.test(s)) return 4 * 60
  const h = s.match(/(\d+(?:[.,]\d+)?)\s*(?:h|heure|hour)/)
  const m = s.match(/(\d+)\s*(?:min)/)
  let total = 0
  if (h) total += parseFloat(h[1].replace(',', '.')) * 60
  const hm = s.match(/(\d+)\s*h\s*(\d{2})/)
  if (hm) total = parseInt(hm[1]) * 60 + parseInt(hm[2])
  else if (m) total += parseInt(m[1])
  return total > 0 ? Math.min(Math.round(total), 12 * 60) : 90
}

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
export const toHHMM = (min: number) =>
  `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

export function durationOf(p: Place): number {
  return p.plan_minutes ?? parseDuration(p.details?.duration)
}

const norm = (s: string | null | undefined) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

/** L'etape du voyage ou se trouve ce lieu (meme ville). */
export function stopOf(place: Place, stops: TripStop[]): TripStop | null {
  const city = norm(place.city)
  if (!city) return null
  return stops.find((s) => norm(s.name) === city || norm(s.name).includes(city) || city.includes(norm(s.name))) ?? null
}

/** Jours couverts par une etape (de l'arrivee au depart inclus). */
export function daysOf(stop: TripStop): string[] {
  if (!stop.arrive_date) return []
  const end = stop.leave_date ?? stop.arrive_date
  const out: string[] = []
  for (let d = stop.arrive_date; d <= end && out.length < 60; d = addDaysIso(d, 1)) out.push(d)
  return out
}

/** Ville ou l'on se trouve un jour donne (d'apres les etapes). */
export function stopOnDay(day: string, stops: TripStop[]): TripStop | null {
  return stops.find((s) => s.arrive_date && s.arrive_date <= day && (s.leave_date ?? s.arrive_date) >= day) ?? null
}

/** Hebergements : dates de sejour, pas des activites de la journee. */
export function isStay(p: Place): boolean {
  return /h[oô]tel|h[ée]bergement|airbnb|resort|hostel/i.test(`${p.name} ${p.details?.kind ?? ""}`) && !/buffet|brunch|bar|caf[ée]|restaurant/i.test(p.name)
}

export type DayLoad = { day: string; items: Place[]; minutes: number }

export function loadOfDay(day: string, places: Place[], exceptId?: string): DayLoad {
  const items = places
    .filter((p) => p.visit_date === day && p.id !== exceptId && p.status === 'wishlist' && !isStay(p))
    .sort((a, b) => (a.plan_time ?? '99').localeCompare(b.plan_time ?? '99'))
  return { day, items, minutes: items.reduce((n, p) => n + durationOf(p), 0) }
}

/** Jours proposes : ceux de l'etape de la ville, les moins charges d'abord. */
export function suggestDays(place: Place, stops: TripStop[], places: Place[]): DayLoad[] {
  const stop = stopOf(place, stops)
  const days = stop ? daysOf(stop) : []
  return days
    .map((d) => loadOfDay(d, places, place.id))
    .sort((a, b) => a.minutes - b.minutes || a.day.localeCompare(b.day))
}

/** Premier creneau libre de la journee pour une duree donnee. */
export function firstFreeSlot(day: DayLoad, minutes: number): number {
  let t = DAY_START
  for (const p of day.items) {
    if (!p.plan_time) continue
    const start = toMinutes(p.plan_time)
    if (t + minutes <= start) return t
    t = Math.max(t, start + durationOf(p))
  }
  return t
}

export type Conflict =
  | { kind: 'elsewhere'; city: string | null; there: string }
  | { kind: 'overlap'; with: Place; nextFree: string }
  | { kind: 'full'; minutes: number }

export function conflictsFor(
  place: Place,
  day: string,
  time: string | null,
  minutes: number,
  stops: TripStop[],
  places: Place[],
): Conflict[] {
  const out: Conflict[] = []
  const stop = stopOf(place, stops)
  const here = stopOnDay(day, stops)
  if (stop && here && here.id !== stop.id) out.push({ kind: 'elsewhere', city: stop.name, there: here.name })
  if (stop && !here) out.push({ kind: 'elsewhere', city: stop.name, there: '' })
  const load = loadOfDay(day, places, place.id)
  if (time) {
    const s = toMinutes(time)
    const e = s + minutes
    const clash = load.items.find((p) => {
      if (!p.plan_time) return false
      const ps = toMinutes(p.plan_time)
      return s < ps + durationOf(p) && ps < e
    })
    if (clash) out.push({ kind: 'overlap', with: clash, nextFree: toHHMM(firstFreeSlot(load, minutes)) })
  }
  if (load.minutes + minutes > DAY_LIMIT) out.push({ kind: 'full', minutes: load.minutes + minutes })
  return out
}

export const fmtMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m} min`)
