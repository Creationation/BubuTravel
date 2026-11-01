import { useEffect, useRef } from 'react'
import { usePlaces } from '../context/PlacesContext'
import { flagOf } from '../lib/countries'
import { findPlaceImage } from '../lib/placeImage'
import { todayIso } from '../lib/tripDates'
import type { CountryProps } from '../lib/worldCountries'
import { sameCountry } from '../lib/worldCountries'
import type { Place } from '../lib/types'
import { useI18n } from '../i18n/I18nContext'
import { CheckIcon, PinIcon } from './hub/icons'

/**
 * Panneau d'un pays touche sur la carte : ce qu'il reste a y faire et ce
 * qui est deja fait, chaque lieu avec sa photo. Cocher fait passer une
 * activite d'une liste a l'autre.
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
  const { t } = useI18n()
  const { places, edit } = usePlaces()
  const inCountry = places.filter((p) => p.country && sameCountry(country, p.country))
  const todo = inCountry.filter((p) => p.status === 'wishlist')
  const done = inCountry.filter((p) => p.status !== 'wishlist')
  const tried = useRef<Set<string>>(new Set())

  // Photos manquantes : recherche en ligne, une a une, puis enregistrees
  // avec le lieu pour ne plus avoir a les chercher.
  useEffect(() => {
    const missing = inCountry.filter((p) => p.image_url == null && !tried.current.has(p.id))
    if (missing.length === 0) return
    let active = true
    ;(async () => {
      for (const p of missing) {
        if (!active) return
        tried.current.add(p.id)
        try {
          const url = await findPlaceImage(p.name, p.city, p.country)
          // Enregistree meme si le panneau s est rafraichi entre-temps
          await edit(p.id, { image_url: url })
        } catch {
          // Hors ligne ou colonne absente : on reessaiera a la prochaine ouverture
        }
      }
    })()
    return () => {
      active = false
    }
  }, [inCountry, edit])

  function toggle(p: Place) {
    void edit(
      p.id,
      p.status === 'wishlist'
        ? { status: 'visited', visit_date: p.visit_date ?? todayIso() }
        : { status: 'wishlist' },
    )
  }

  return (
    <div className="panel-enter absolute inset-x-2 bottom-2 z-[1100] flex max-h-[65%] flex-col overflow-hidden rounded-[24px] border border-line bg-[color-mix(in_srgb,var(--surface-solid)_90%,transparent)] shadow-[var(--shadow-lg)] backdrop-blur-xl md:inset-x-auto md:bottom-4 md:left-4 md:top-4 md:max-h-none md:w-[400px]">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3.5 sm:px-5">
        <span className="shrink-0 text-3xl leading-none">{flagOf(country.nameFr)}</span>
        <div className="min-w-0 flex-1">
          <h2 className="display-sm truncate text-2xl">{country.nameFr}</h2>
          <p className="num text-[12px] text-text-muted">{t('map.countryCount', { n: inCountry.length })}</p>
        </div>
        <button onClick={onClose} className="btn btn-quiet btn-xs shrink-0">
          {t('common.close')}
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-5">
        {inCountry.length === 0 ? (
          <p className="py-4 text-[14px] text-text-muted">{t('map.countryEmpty')}</p>
        ) : (
          <div className="space-y-5">
            <List title={t('map.countryTodo')} items={todo} onToggle={toggle} onOpen={onOpenPlace} />
            <List title={t('map.countryDone')} items={done} onToggle={toggle} onOpen={onOpenPlace} />
          </div>
        )}
      </div>
    </div>
  )
}

function List({
  title,
  items,
  onToggle,
  onOpen,
}: {
  title: string
  items: Place[]
  onToggle: (p: Place) => void
  onOpen: (p: Place) => void
}) {
  const { t } = useI18n()
  if (items.length === 0) return null
  return (
    <section>
      <p className="eyebrow mb-2">
        {title}
        <span className="num normal-case tracking-normal">{items.length}</span>
      </p>
      <ul className="space-y-2">
        {items.map((p) => {
          const done = p.status !== 'wishlist'
          return (
            <li key={p.id} className="flex items-center gap-3 rounded-2xl p-1.5 transition-colors hover:bg-surface-2">
              <button onClick={() => onOpen(p)} className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-surface-2">
                {p.image_url ? (
                  <img
                    src={p.image_url}
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
              <button onClick={() => onOpen(p)} className="min-w-0 flex-1 text-left">
                <span className={`block truncate text-[14px] ${done ? 'text-text-muted line-through' : 'font-semibold'}`}>
                  {p.name}
                </span>
                {p.city && <span className="block truncate text-[12px] text-text-muted">{p.city}</span>}
              </button>
              <button
                onClick={() => onToggle(p)}
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
  )
}
