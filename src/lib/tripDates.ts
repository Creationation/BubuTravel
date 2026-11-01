import type { TripStop } from './types'

/**
 * Petites aides de dates pour le carnet de route. Toutes les dates « jour »
 * sont des chaines AAAA-MM-JJ en heure locale : on ne passe jamais par l'UTC,
 * qui decalerait d'un jour selon le fuseau du telephone.
 */

const pad = (n: number) => String(n).padStart(2, '0')

export function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function nowLocalIso(): string {
  const d = new Date()
  return `${todayIso()}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`
}

function toDate(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T12:00:00`)
}

/** Nombre de jours entiers de a vers b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000)
}

export function addDaysIso(iso: string, days: number): string {
  const d = toDate(iso)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function nightsOf(stop: Pick<TripStop, 'arrive_date' | 'leave_date'>): number | null {
  if (!stop.arrive_date || !stop.leave_date) return null
  return Math.max(0, daysBetween(stop.arrive_date, stop.leave_date))
}

export type Countdown =
  | { kind: 'before'; days: number }
  | { kind: 'during'; day: number; total: number }
  | { kind: 'after'; days: number }
  | { kind: 'none' }

export function countdown(start: string | null, end: string | null, today = todayIso()): Countdown {
  if (!start) return { kind: 'none' }
  if (today < start) return { kind: 'before', days: daysBetween(today, start) }
  if (!end || today <= end) {
    return {
      kind: 'during',
      day: daysBetween(start, today) + 1,
      total: end ? daysBetween(start, end) + 1 : 0,
    }
  }
  return { kind: 'after', days: daysBetween(end, today) }
}

/** « 18 déc. » ou « mer. 18 déc. » */
export function shortDate(iso: string | null, locale: string, withWeekday = false): string {
  if (!iso) return ''
  return toDate(iso).toLocaleDateString(locale, {
    ...(withWeekday ? { weekday: 'short' } : {}),
    day: 'numeric',
    month: 'short',
  })
}

/** « mer. 18 déc., 10:30 » pour une heure locale sans fuseau. */
export function shortDateTime(local: string | null, locale: string): string {
  if (!local) return ''
  const [d, t] = local.split('T')
  const time = t ? t.slice(0, 5) : ''
  return `${shortDate(d, locale, true)}${time ? `, ${time}` : ''}`
}

/** Valeur pour un <input type="datetime-local"> */
export function toInputDateTime(local: string | null): string {
  return local ? local.slice(0, 16) : ''
}

export function fromInputDateTime(value: string): string | null {
  return value ? `${value}:00` : null
}

/** Trous et chevauchements entre etapes consecutives datees. */
export function routeIssues(
  stops: TripStop[],
): { kind: 'gap' | 'overlap'; a: TripStop; b: TripStop }[] {
  const out: { kind: 'gap' | 'overlap'; a: TripStop; b: TripStop }[] = []
  const ordered = [...stops].sort((x, y) => x.position - y.position)
  for (let i = 0; i < ordered.length - 1; i++) {
    const a = ordered[i]
    const b = ordered[i + 1]
    if (!a.leave_date || !b.arrive_date) continue
    // Un vol de nuit fait arriver le lendemain : un jour d'ecart est normal
    const gap = daysBetween(a.leave_date, b.arrive_date)
    if (gap > 1) out.push({ kind: 'gap', a, b })
    if (gap < 0) out.push({ kind: 'overlap', a, b })
  }
  return out
}

/** L'etape ou l'on se trouve aujourd'hui, sinon la prochaine. */
export function currentAndNext(
  stops: TripStop[],
  today = todayIso(),
): { current: TripStop | null; next: TripStop | null } {
  const ordered = [...stops].sort((x, y) => x.position - y.position)
  const current =
    ordered.find(
      (s) => s.arrive_date && s.arrive_date <= today && (!s.leave_date || s.leave_date > today),
    ) ?? null
  const next = ordered.find((s) => s.arrive_date && s.arrive_date > today) ?? null
  return { current, next }
}

export function mapsLink(stop: Pick<TripStop, 'lat' | 'lng' | 'name' | 'stay_address'>): string {
  const q = stop.stay_address || (stop.lat != null && stop.lng != null ? `${stop.lat},${stop.lng}` : stop.name)
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
}
