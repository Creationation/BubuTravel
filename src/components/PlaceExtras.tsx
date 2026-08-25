import type { Place } from '../lib/types'

export const PRICE_LEVELS = [
  { value: 1, label: '€', hint: 'Petit budget' },
  { value: 2, label: '€€', hint: 'Raisonnable' },
  { value: 3, label: '€€€', hint: 'Cher' },
  { value: 4, label: '€€€€', hint: 'Tres cher' },
] as const

export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'THB', 'MAD', 'CAD'] as const

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount)
  } catch {
    // Une devise inconnue ne doit pas casser l'affichage
    return `${amount} ${currency}`
  }
}

/** La promotion est-elle encore valable aujourd'hui ? */
export function promoActive(place: Pick<Place, 'promo_until'>): boolean {
  if (!place.promo_until) return true
  const today = new Date()
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate(),
  ).padStart(2, '0')}`
  return place.promo_until >= iso
}

/** Etoiles en lecture seule, ou cliquables si onChange est fourni. */
export function Stars({
  value,
  onChange,
  size = 18,
}: {
  value: number | null
  onChange?: (next: number | null) => void
  size?: number
}) {
  const readOnly = !onChange

  return (
    <span className="inline-flex items-center gap-0.5" role={readOnly ? 'img' : undefined}
      aria-label={readOnly ? `Note ${value ?? 0} sur 5` : undefined}>
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = (value ?? 0) >= star
        const content = (
          <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
            <path
              d="M12 2.6l2.75 5.94 6.5.78-4.8 4.45 1.28 6.43L12 16.98 6.27 20.2l1.28-6.43-4.8-4.45 6.5-.78z"
              fill={filled ? 'var(--color-ochre)' : 'none'}
              stroke={filled ? 'var(--color-ochre)' : 'var(--line-strong)'}
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
          </svg>
        )
        if (readOnly) return <span key={star}>{content}</span>
        return (
          <button
            key={star}
            type="button"
            // Recliquer sur la meme etoile retire la note : sans ca, une note
            // posee par erreur ne pourrait plus jamais etre enlevee.
            onClick={() => onChange(value === star ? null : star)}
            className="transition-transform hover:scale-110"
            aria-label={`Noter ${star} sur 5`}
          >
            {content}
          </button>
        )
      })}
    </span>
  )
}

/** Resume compact affiche sous le titre d'un lieu. */
export default function PlaceExtras({ place }: { place: Place }) {
  const level = PRICE_LEVELS.find((p) => p.value === place.price_level)
  const hasPromo = Boolean(place.promo_code || place.promo_note)
  const nothing = !place.rating && !level && place.cost === null && !hasPromo && !place.review

  if (nothing) return null

  return (
    <div className="space-y-3">
      {(place.rating || level || place.cost !== null) && (
        <div className="flex flex-wrap items-center gap-3">
          {place.rating !== null && <Stars value={place.rating} />}
          {level && (
            <span className="pill" title={level.hint}>
              {level.label}
            </span>
          )}
          {place.cost !== null && (
            <span className="pill">{formatMoney(place.cost, place.currency)}</span>
          )}
        </div>
      )}

      {place.review && (
        <p className="whitespace-pre-wrap border-l-2 border-line pl-3 text-[14px] italic leading-relaxed text-text-soft">
          {place.review}
        </p>
      )}

      {hasPromo && (
        <div
          className={`rounded-2xl border p-3 ${
            promoActive(place) ? 'border-line bg-surface-2' : 'border-line opacity-60'
          }`}
        >
          <p className="eyebrow mb-1.5">
            {promoActive(place) ? 'Bon plan' : 'Bon plan expire'}
          </p>
          {place.promo_note && <p className="text-[13px] text-text-soft">{place.promo_note}</p>}
          {place.promo_code && (
            <p className="mt-2 font-mono text-[13px] tracking-wider text-accent">
              {place.promo_code}
            </p>
          )}
          {place.promo_until && (
            <p className="mt-1.5 text-[11px] text-text-muted">
              Valable jusqu'au{' '}
              {new Date(`${place.promo_until}T00:00:00`).toLocaleDateString('fr-FR')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
