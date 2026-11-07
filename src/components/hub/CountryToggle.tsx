import { flagOf } from '../../lib/countries'
import { countryName } from '../../lib/countryName'
import { useI18n } from '../../i18n/I18nContext'

/**
 * Interrupteur de pays, au milieu : « Les deux » / Thailande / Vietnam.
 * Le curseur glisse d'un choix a l'autre. Choisir un pays ne montre plus que
 * ses lieux, ses etapes et ses jours.
 */
export default function CountryToggle({
  countries,
  value,
  onChange,
}: {
  countries: string[]
  value: string | null
  onChange: (country: string | null) => void
}) {
  const { t } = useI18n()
  const items: { id: string | null; label: string; icon: string }[] = [
    { id: null, label: t('scope.both'), icon: '🌏' },
    ...countries.map((c) => ({ id: c, label: countryName(c), icon: flagOf(c) })),
  ]
  const index = Math.max(0, items.findIndex((i) => i.id === value))
  return (
    <div className="mt-7 flex justify-center">
      <div
        role="radiogroup"
        aria-label={t('scope.title')}
        className="relative grid w-full max-w-md rounded-full border border-line bg-surface-solid p-1 shadow-[var(--shadow-sm)]"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {/* Curseur qui glisse */}
        <span
          aria-hidden="true"
          className="absolute bottom-1 left-1 top-1 rounded-full bg-accent shadow-[var(--shadow-sm)] transition-transform duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ width: `calc((100% - 0.5rem) / ${items.length})`, transform: `translateX(${index * 100}%)` }}
        />
        {items.map((i) => {
          const active = i.id === value
          return (
            <button
              key={i.id ?? 'both'}
              role="radio"
              aria-checked={active}
              onClick={() => onChange(i.id)}
              className={`relative z-10 flex min-w-0 items-center justify-center gap-1.5 rounded-full px-2 py-2.5 text-[13.5px] font-extrabold transition-colors duration-300 active:scale-95 ${
                active ? 'text-accent-ink' : 'text-text-muted'
              }`}
            >
              <span className="text-[16px] leading-none">{i.icon}</span>
              <span className="truncate">{i.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
