import { addDaysIso } from './tripDates'
import { isStay } from './schedule'
import type { Place, Trip, TripDocument, TripStop } from './types'

/**
 * Les trous d'un voyage : ce qui manque pour que tout tienne.
 *  - nostop      : des jours ou l'on ne sait pas ou l'on est (aucune etape)
 *  - nostay      : une etape sans hebergement
 *  - notransport : un changement de ville sans vol, train ou bus renseigne
 *  - empty       : des jours d'une etape sans aucune activite prevue
 */
export type GapType = 'nostop' | 'nostay' | 'notransport' | 'empty'

export type Gap = {
  id: string
  type: GapType
  from: string
  to: string
  /** Nombre de jours (nostop, empty) ou de nuits (nostay). */
  days: number
  stopId?: string
  city?: string
  country?: string | null
  lat?: number | null
  lng?: number | null
  /** Pour un trajet : la ville d'arrivee. */
  toCity?: string
  toCountry?: string | null
}

const norm = (s: string | null | undefined) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to && out.length < 400; d = addDaysIso(d, 1)) out.push(d)
  return out
}

const hasStay = (s: TripStop) =>
  Boolean(s.stay_name || s.stay_address || (s.hosts ?? []).some((h) => h.stay || h.name))

export function detectGaps(trip: Trip, stops: TripStop[], places: Place[], docs: TripDocument[]): Gap[] {
  const dated = stops
    .filter((s) => s.arrive_date)
    .map((s) => ({ ...s, leave: s.leave_date ?? s.arrive_date! }))
    .sort((a, b) => a.arrive_date!.localeCompare(b.arrive_date!))
  const gaps: Gap[] = []
  const start = trip.start_date ?? dated[0]?.arrive_date
  const end = trip.end_date ?? dated[dated.length - 1]?.leave
  if (!start || !end) return gaps

  // Jours couverts : par une etape, ou par un vol/trajet date ce jour-la
  const flightDays = new Set<string>()
  for (const d of docs) if (['flight', 'transport'].includes(d.kind) && d.doc_date) flightDays.add(d.doc_date.slice(0, 10))
  for (const s of dated) if (s.transport_departs) flightDays.add(s.transport_departs.slice(0, 10))

  const covered = new Set<string>()
  for (const s of dated) for (const d of eachDay(s.arrive_date!, s.leave)) covered.add(d)

  // 1. Jours sans etape (les jours de vol ne comptent pas comme un trou)
  let run: string[] = []
  const flush = () => {
    if (run.length) gaps.push({ id: `nostop:${run[0]}`, type: 'nostop', from: run[0], to: run[run.length - 1], days: run.length })
    run = []
  }
  for (const d of eachDay(start, end)) {
    if (!covered.has(d) && !flightDays.has(d)) run.push(d)
    else flush()
  }
  flush()

  // 2. Hebergement manquant, etape par etape
  for (const s of dated) {
    const nights = Math.round((new Date(s.leave).getTime() - new Date(s.arrive_date!).getTime()) / 86400000)
    if (nights > 0 && !hasStay(s)) {
      gaps.push({
        id: `nostay:${s.id}`, type: 'nostay', from: s.arrive_date!, to: s.leave, days: nights,
        stopId: s.id, city: s.name, country: s.country, lat: s.lat, lng: s.lng,
      })
    }
  }

  // 3. Changement de ville sans transport
  for (let i = 0; i < dated.length - 1; i++) {
    const a = dated[i]
    const b = dated[i + 1]
    if (norm(a.name) === norm(b.name)) continue
    const known = a.transport_mode || a.transport_details || (a.transport_departs && a.transport_departs.length > 0)
    const docMatch = docs.some(
      (d) => ['flight', 'transport'].includes(d.kind) && d.doc_date && d.doc_date.slice(0, 10) >= a.leave && d.doc_date.slice(0, 10) <= (b.arrive_date ?? a.leave),
    )
    if (!known && !docMatch) {
      gaps.push({
        id: `notransport:${a.id}`, type: 'notransport', from: a.leave, to: b.arrive_date ?? a.leave, days: 1,
        stopId: a.id, city: a.name, country: a.country, lat: a.lat, lng: a.lng, toCity: b.name, toCountry: b.country,
      })
    }
  }

  // 4. Jours d'etape sans activite
  const busy = new Set(places.filter((p) => p.trip_id === trip.id && p.visit_date && !isStay(p)).map((p) => p.visit_date!))
  for (const s of dated) {
    let r: string[] = []
    const push = () => {
      if (r.length) gaps.push({ id: `empty:${s.id}:${r[0]}`, type: 'empty', from: r[0], to: r[r.length - 1], days: r.length, stopId: s.id, city: s.name, country: s.country, lat: s.lat, lng: s.lng })
      r = []
    }
    for (const d of eachDay(s.arrive_date!, s.leave)) {
      // Les jours d'arrivee et de depart sont deja pris par le trajet
      const travel = d === s.arrive_date || d === s.leave
      if (!busy.has(d) && !travel) r.push(d)
      else push()
    }
    push()
  }

  const order: Record<GapType, number> = { nostop: 0, notransport: 1, nostay: 2, empty: 3 }
  return gaps.sort((x, y) => order[x.type] - order[y.type] || x.from.localeCompare(y.from))
}
