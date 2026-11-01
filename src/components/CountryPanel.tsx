import { useMemo, useState } from 'react'
import { usePlaces } from '../context/PlacesContext'
import { flagOf } from '../lib/countries'
import { shortDate, todayIso } from '../lib/tripDates'
import type { CountryProps } from '../lib/worldCountries'
import { sameCountry } from '../lib/worldCountries'
import type { Place } from '../lib/types'
import { useI18n } from '../i18n/I18nContext'
import { CheckIcon, PinIcon } from './hub/icons'
import { askReview } from './ReviewSheet'

type Show = 'todo' | 'done' | 'all'

/**
 * Panneau d'un pays touche sur la carte : les activites rangees par ville,
 * avec leur photo et leur date. Filtre A faire / Deja fait / Tout ; cocher
 * fait passer une activite d'une liste a l'autre.
 */
export default function CountryPanel({
  country,
  onOpenPlace,
  onClose,
}: {
  country: CountryProps
  onOpenPlace: (place: Place) => void
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  const { places, edit } = usePlaces()
  const [show, setShow] = useState<Show>('todo')

  const inCountry = useMemo(
    () => places.filter((p) => p.country && sameCountry(country, p.country)),
    [places, country],
  )
  const todoCount = inCountry.filter((p) => p.status === 'wishlist').length
  const doneCount = inCountry.length - todoCount

  // Villes dans l'ordre chronologique du voyage (date la plus proche d'abord)
  const cities = useMemo(() => {
    const list = inCountry.filter((p) =>
      show === 'all' ? true : show === 'todo' ? p.status === 'wishlist' : p.status !== 'wishlist',
    )
    const map = new Map<string, Place[]>()
    for (const p of list) {
      const key = p.city?.trim() || t('map.otherCity')
      map.set(key, [...(map.get(key) ?? []), p])
    }
    const first = (items: Place[]) => items.map((p) => p.visit_date ?? '9999').sort()[0]
    return [...map.entries()]
      .map(([city, items]) => ({
        city,
        items: items.sort(
          (a, b) => (a.visit_date ?? '9999').localeCompare(b.visit_date ?? '9999') || a.name.localeCompare(b.name, 'fr'),
        ),
      }))
      .sort((a, b) => first(a.items).localeCompare(first(b.items)) || b.items.length - a.items.length)
  }, [inCountry, show, t])

  function toggle(p: Place) {
    const visiting = p.status === 'wishlist'
    void edit(p.id, visiting ? { status: 'visited', visit_date: p.visit_date ?? todayIso() } : { status: 'wishlist' }).then(
      () => visiting && askReview(p.id),
    )
  }

  return (
    <div className="panel-enter absolute inset-x-2 bottom-2 z-[1100] flex max-h-[68%] flex-col overflow-hidden rounded-[24px] border border-line bg-[color-mix(in_srgb,var(--surface-solid)_92%,transparent)] shadow-[var(--shadow-lg)] backdrop-blur-xl md:inset-x-auto md:bottom-4 md:left-4 md:top-4 md:max-h-none md:w-[420px]">
      <header className="shrink-0 border-b border-line px-4 pb-3 pt-4 sm:px-5">
        <div className="flex items-center gap-3">
          <span className="shrink-0 text-3xl leading-none">{flagOf(country.nameFr)}</span>
          <div className="min-w-0 flex-1">
            <h2 className="display truncate text-[1.8rem] leading-none">{country.nameFr}</h2>
            <p className="num mt-1 text-[12px] text-text-muted">
              {t('map.countryCount', { n: inCountry.length })} ·{' '}
              {cities.length > 1 ? t('map.cities', { n: cities.length }) : t('map.city')}
            </p>
          </div>
          <button onClick={onClose} className="btn btn-quiet btn-xs shrink-0">
            {t('common.close')}
          </button>
        </div>
        <div className="tabbar mt-3 w-full">
          {(
            [
              ['todo', `${t('map.countryTodo')} ${todoCount}`],
              ['done', `${t('map.countryDone')} ${doneCount}`],
              ['all', t('map.all')],
            ] as [Show, string][]
          ).map(([k, label]) => (
            <button key={k} onClick={() => setShow(k)} className={`tab num flex-1 justify-center ${show === k ? 'tab-active' : ''}`}>
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 sm:px-4">
        {cities.length === 0 ? (
          <p className="px-2 py-6 text-[14px] text-text-muted">{t('map.countryEmpty')}</p>
        ) : (
          <div className="space-y-5">
            {cities.map(({ city, items }) => (
              <section key={city}>
                <div className="sticky top-0 z-10 -mx-1 mb-2 flex items-baseline justify-between bg-[color-mix(in_srgb,var(--surface-solid)_94%,transparent)] px-2 py-1.5 backdrop-blur">
                  <h3 className="display-sm text-xl">{city}</h3>
                  <span className="num text-[12px] text-text-muted">{items.length}</span>
                </div>
                <ul className="space-y-1.5">
                  {items.map((p) => {
                    const done = p.status !== 'wishlist'
                    const img = p.gallery?.[0] || p.image_url
                    return (
                      <li key={p.id} className="flex items-center gap-3 rounded-2xl p-1.5 transition-colors hover:bg-surface-2">
                        <button onClick={() => onOpenPlace(p)} className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-surface-2">
                          {img ? (
                            <img
                              src={img}
                              alt=""
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              className={`h-full w-full object-cover ${done ? 'opacity-60 grayscale-[40%]' : ''}`}
                            />
                          ) : (
                            <span className="flex h-full w-full items-center justify-center text-text-muted">
                              <PinIcon size={18} />
                            </span>
                          )}
                        </button>
                        <button onClick={() => onOpenPlace(p)} className="min-w-0 flex-1 text-left">
                          <span className={`line-clamp-2 text-[14px] leading-snug ${done ? 'text-text-muted line-through' : 'font-semibold'}`}>
                            {p.name}
                          </span>
                          <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-text-muted">
                            {p.visit_date && <span className="chip chip-accent num py-0">{shortDate(p.visit_date, locale)}</span>}
                            {p.details?.price && <span className="truncate">{p.details.price}</span>}
                          </span>
                        </button>
                        <button
                          onClick={() => toggle(p)}
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors ${
                            done ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong hover:border-accent'
                          }`}
                          aria-label={done ? t('map.countryMarkTodo') : t('map.countryMarkDone')}
                        >
                          {done && <CheckIcon size={14} />}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
