import { todayIso } from './tripDates'
import type { Trip } from './types'

/**
 * « Le » voyage du moment : celui en cours, sinon le prochain, sinon le plus
 * recent. C'est lui qu'ouvre le bouton Voyage de la barre du bas.
 */
export function pickCurrentTrip(trips: Trip[], today = todayIso()): Trip | null {
  const ongoing = trips.find((t) => t.start_date && t.start_date <= today && (!t.end_date || t.end_date >= today))
  if (ongoing) return ongoing
  const upcoming = trips
    .filter((t) => t.start_date && t.start_date > today)
    .sort((a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? ''))[0]
  if (upcoming) return upcoming
  const planning = trips.find((t) => t.status === 'planning')
  return planning ?? trips[0] ?? null
}
