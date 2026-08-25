import type { Recurrence, TravelEvent } from './types'

export const RECURRENCES: { value: Recurrence; fr: string; en: string }[] = [
  { value: 'none', fr: 'Une seule fois', en: 'One time only' },
  { value: 'daily', fr: 'Tous les jours', en: 'Every day' },
  { value: 'weekly', fr: 'Toutes les semaines', en: 'Every week' },
  { value: 'monthly', fr: 'Tous les mois', en: 'Every month' },
  { value: 'yearly', fr: 'Tous les ans', en: 'Every year' },
]

/**
 * Prochaine occurrence a partir d'aujourd'hui. On avance pas a pas plutot
 * que par un calcul direct : les mois et les annees n'ont pas une duree
 * constante, et un 31 janvier repousse d'un mois doit tomber en fevrier sans
 * deraper sur mars.
 */
export function nextOccurrence(event: TravelEvent, from: Date = new Date()): Date | null {
  const start = new Date(event.starts_at)
  if (Number.isNaN(start.getTime())) return null
  if (event.recurrence === 'none') return start >= from ? start : null

  const limit = event.recurrence_until ? new Date(`${event.recurrence_until}T23:59:59`) : null
  const cursor = new Date(start)
  // Une boucle bornee : au-dela, la recurrence n'a plus d'interet a afficher
  for (let i = 0; i < 4000; i++) {
    if (cursor >= from) return limit && cursor > limit ? null : cursor
    if (limit && cursor > limit) return null

    switch (event.recurrence) {
      case 'daily':
        cursor.setDate(cursor.getDate() + 1)
        break
      case 'weekly':
        cursor.setDate(cursor.getDate() + 7)
        break
      case 'monthly': {
        const day = start.getDate()
        cursor.setDate(1)
        cursor.setMonth(cursor.getMonth() + 1)
        // Un 31 dans un mois de 30 jours retombe sur le dernier jour du mois
        const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
        cursor.setDate(Math.min(day, last))
        break
      }
      case 'yearly':
        cursor.setFullYear(cursor.getFullYear() + 1)
        break
      default:
        return null
    }
  }
  return null
}

export function isPast(event: TravelEvent, from: Date = new Date()): boolean {
  return nextOccurrence(event, from) === null
}

/** Tri par prochaine occurrence, les evenements passes a la fin. */
export function sortByNext(events: TravelEvent[], from: Date = new Date()): TravelEvent[] {
  return [...events].sort((a, b) => {
    const na = nextOccurrence(a, from)
    const nb = nextOccurrence(b, from)
    if (na && nb) return na.getTime() - nb.getTime()
    if (na) return -1
    if (nb) return 1
    // Deux evenements passes : le plus recent d'abord
    return new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime()
  })
}

export function formatEventDate(event: TravelEvent, locale: string, date?: Date | null): string {
  const when = date ?? new Date(event.starts_at)
  if (event.all_day) {
    return when.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  }
  return when.toLocaleString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Convertit une valeur d'input datetime-local en ISO, sans decalage surprise. */
export function localInputToIso(value: string): string {
  // new Date('2026-08-25T18:30') est interprete en heure locale, ce qui est
  // exactement ce que l'utilisateur a saisi.
  return new Date(value).toISOString()
}

export function isoToLocalInput(iso: string | null, allDay = false): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  return allDay ? date : `${date}T${p(d.getHours())}:${p(d.getMinutes())}`
}
