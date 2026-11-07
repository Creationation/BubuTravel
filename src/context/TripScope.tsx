import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import { countryCode } from '../lib/countryName'
import { addDaysIso } from '../lib/tripDates'
import type { TripStop } from '../lib/types'

/**
 * Pays regarde dans un voyage a plusieurs pays (ex. Thailande + Vietnam).
 * `country` = null veut dire « les deux » : rien n'est filtre. Sinon les
 * lieux, les etapes, les jours de l'agenda et le plan du jour ne montrent que
 * ce pays, pour ne jamais melanger les deux parties du voyage.
 */
export type Scope = {
  country: string | null
  isIn: (c: string | null | undefined) => boolean
  places: <T extends { country: string }>(list: T[]) => T[]
  stops: (list: TripStop[]) => TripStop[]
  /** Jours couverts par les etapes du pays (null = pas de filtre). */
  days: string[] | null
  range: { from: string; to: string } | null
}

const same = (a: string | null | undefined, b: string | null | undefined) => {
  if (!a || !b) return false
  const ca = countryCode(a)
  const cb = countryCode(b)
  return ca && cb ? ca === cb : a.trim().toLowerCase() === b.trim().toLowerCase()
}

const ALL: Scope = {
  country: null,
  isIn: () => true,
  places: (l) => l,
  stops: (l) => l,
  days: null,
  range: null,
}

const Ctx = createContext<Scope>(ALL)

export function TripScopeProvider({ country, stops, children }: { country: string | null; stops: TripStop[]; children: ReactNode }) {
  const value = useMemo<Scope>(() => {
    if (!country) return ALL
    const mine = stops.filter((s) => same(s.country, country))
    const days: string[] = []
    for (const s of mine) {
      if (!s.arrive_date) continue
      for (let d = s.arrive_date, n = 0; d <= (s.leave_date ?? s.arrive_date) && n < 400; d = addDaysIso(d, 1), n++) if (!days.includes(d)) days.push(d)
    }
    days.sort()
    return {
      country,
      isIn: (c) => same(c, country),
      places: (l) => l.filter((p) => same(p.country, country)),
      stops: (l) => l.filter((s) => same(s.country, country)),
      days,
      range: days.length ? { from: days[0], to: days[days.length - 1] } : null,
    }
  }, [country, stops])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useScope(): Scope {
  return useContext(Ctx)
}
