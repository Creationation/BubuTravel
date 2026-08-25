import { useMemo, useState } from 'react'
import { usePlaces } from '../context/PlacesContext'
import { plural } from '../lib/stats'
import { useT } from '../i18n/I18nContext'
import type { Place } from '../lib/types'

export type MapFilter = {
  query: string
  status: 'all' | 'visited' | 'wishlist'
  country: string
  categoryId: string
  tripId: string
}

export const emptyFilter: MapFilter = {
  query: '',
  status: 'all',
  country: '',
  categoryId: '',
  tripId: '',
}

export function applyFilter(places: Place[], f: MapFilter): Place[] {
  const q = f.query.trim().toLowerCase()
  return places.filter((p) => {
    if (f.status === 'visited' && p.status === 'wishlist') return false
    if (f.status === 'wishlist' && p.status !== 'wishlist') return false
    if (f.country && p.country !== f.country) return false
    if (f.categoryId && p.category_id !== f.categoryId) return false
    if (f.tripId && p.trip_id !== f.tripId) return false
    if (q) {
      const haystack = `${p.name} ${p.city ?? ''} ${p.country} ${p.notes ?? ''}`.toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })
}

export function isFilterActive(f: MapFilter): boolean {
  return (
    f.query.trim() !== '' ||
    f.status !== 'all' ||
    f.country !== '' ||
    f.categoryId !== '' ||
    f.tripId !== ''
  )
}

/**
 * Recherche et filtres au-dessus de la carte. Repliable : quand le carnet
 * grossit, retrouver un lieu par son nom devient plus rapide que de le
 * chercher a l'oeil sur le planisphere.
 */
export default function MapFilters({
  value,
  onChange,
  shown,
  total,
}: {
  value: MapFilter
  onChange: (next: MapFilter) => void
  shown: number
  total: number
}) {
  const { countries, categories, trips } = usePlaces()
  const t = useT()
  const [open, setOpen] = useState(false)
  const active = isFilterActive(value)

  const summary = useMemo(() => {
    if (!active) return plural(total, t('unit.place'), t('unit.places'))
    return t('map.ofTotal', { shown, total })
  }, [active, shown, total, t])

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        className="field w-auto min-w-40 max-w-56 py-1.5 text-[13px]"
        value={value.query}
        onChange={(e) => onChange({ ...value, query: e.target.value })}
        placeholder={t('map.searchPlace')}
        aria-label={t('map.searchPlace')}
      />

      <button
        onClick={() => setOpen((v) => !v)}
        className={`btn btn-xs ${active ? 'btn-accent' : ''}`}
      >
        {t('map.filters')}
      </button>

      <span className="text-[12px] text-text-muted">{summary}</span>

      {active && (
        <button onClick={() => onChange(emptyFilter)} className="btn btn-xs btn-quiet">
          {t('map.clearFilters')}
        </button>
      )}

      {open && (
        <div className="panel fade-in absolute left-5 top-full z-[1100] mt-2 w-[min(92vw,24rem)] space-y-3 p-4 shadow-xl sm:left-8">
          <div>
            <p className="label">{t('map.status')}</p>
            <div className="flex gap-2">
              {(
                [
                  ['all', 'common.all'],
                  ['visited', 'map.visited'],
                  ['wishlist', 'map.toVisit'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => onChange({ ...value, status: key })}
                  className={`pill flex-1 justify-center ${value.status === key ? 'pill-active' : ''}`}
                >
                  {t(label)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="label">{t('common.country')}</p>
            <select
              className="field"
              value={value.country}
              onChange={(e) => onChange({ ...value, country: e.target.value })}
            >
              <option value="">{t('map.allCountries')}</option>
              {countries.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {categories.length > 0 && (
            <div>
              <p className="label">{t('common.category')}</p>
              <select
                className="field"
                value={value.categoryId}
                onChange={(e) => onChange({ ...value, categoryId: e.target.value })}
              >
                <option value="">{t('common.all')}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {trips.length > 0 && (
            <div>
              <p className="label">{t('common.trip')}</p>
              <select
                className="field"
                value={value.tripId}
                onChange={(e) => onChange({ ...value, tripId: e.target.value })}
              >
                <option value="">{t('common.all')}</option>
                {trips.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button onClick={() => setOpen(false)} className="btn btn-xs w-full">
            {t('common.close')}
          </button>
        </div>
      )}
    </div>
  )
}
