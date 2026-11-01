import { usePlaces } from '../context/PlacesContext'
import { flagOf } from '../lib/countries'
import { todayIso } from '../lib/tripDates'
import type { CountryProps } from '../lib/worldCountries'
import { sameCountry } from '../lib/worldCountries'
import type { Place } from '../lib/types'
import { useI18n } from '../i18n/I18nContext'
import { CheckIcon } from './hub/icons'

/**
 * Panneau d'un pays touche sur la carte : ce qu'il reste a y faire et ce
 * qui est deja fait. Cocher fait passer une activite d'une liste a l'autre.
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

  function toggle(p: Place) {
    void edit(
      p.id,
      p.status === 'wishlist'
        ? { status: 'visited', visit_date: p.visit_date ?? todayIso() }
        : { status: 'wishlist' },
    )
  }

  return (
    <div className="panel-enter absolute inset-x-3 bottom-3 z-[1100] max-h-[62%] overflow-hidden rounded-[24px] border border-line bg-[color-mix(in_srgb,var(--surface-solid)_88%,transparent)] shadow-[var(--shadow-lg)] backdrop-blur-xl md:inset-x-auto md:bottom-auto md:left-4 md:top-4 md:max-h-[calc(100%-2rem)] md:w-[380px]">
      <header className="flex items-center gap-3 border-b border-line px-5 py-4">
        <span className="text-3xl leading-none">{flagOf(country.nameFr)}</span>
        <div className="min-w-0 flex-1">
          <h2 className="display-sm truncate text-2xl">{country.nameFr}</h2>
          <p className="num text-[12px] text-text-muted">{t('map.countryCount', { n: inCountry.length })}</p>
        </div>
        <button onClick={onClose} className="btn btn-quiet btn-xs">
          {t('common.close')}
        </button>
      </header>

      <div className="max-h-[calc(62vh-5rem)] overflow-y-auto px-5 py-4 md:max-h-[calc(100vh-14rem)]">
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
      <ul className="divide-y divide-line">
        {items.map((p) => {
          const done = p.status !== 'wishlist'
          return (
            <li key={p.id} className="flex items-center gap-3 py-2.5">
              <button
                onClick={() => onToggle(p)}
                className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border transition-colors ${
                  done ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong hover:border-accent'
                }`}
                aria-label={done ? t('map.countryMarkTodo') : t('map.countryMarkDone')}
              >
                {done && <CheckIcon size={13} />}
              </button>
              <button onClick={() => onOpen(p)} className="min-w-0 flex-1 text-left">
                <span className={`block truncate text-[14px] ${done ? 'text-text-muted' : 'font-medium'}`}>{p.name}</span>
                {p.city && <span className="block truncate text-[12px] text-text-muted">{p.city}</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
