import { useT } from '../i18n/I18nContext'
import { pinSvg } from './mapIcon'
import type { MapFilter } from './MapFilters'

/**
 * Legende ET filtre : « Visité » et « À visiter » s'allument ou s'eteignent
 * d'un tap. Les deux allumes = tout ; au moins un reste toujours allume.
 * Le choix pilote aussi la couleur des pays (illumines en mode « Visité »).
 */
export default function MapLegend({
  value,
  onChange,
}: {
  value: MapFilter['status']
  onChange: (status: MapFilter['status']) => void
}) {
  const t = useT()
  const visitedOn = value !== 'wishlist'
  const wishOn = value !== 'visited'

  function toggle(which: 'visited' | 'wishlist') {
    const on = which === 'visited' ? visitedOn : wishOn
    const other = which === 'visited' ? wishOn : visitedOn
    if (on && other) onChange(which === 'visited' ? 'wishlist' : 'visited') // eteint celui-ci
    else if (on) onChange(which === 'visited' ? 'wishlist' : 'visited') // seul allume : on bascule
    else onChange('all') // rallume celui-ci, les deux sont visibles
  }

  return (
    <div className="panel flex items-center gap-1 p-1 shadow-lg" role="group">
      <button
        onClick={() => toggle('visited')}
        aria-pressed={visitedOn}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-all ${
          visitedOn ? 'bg-[rgba(255,176,32,0.22)] text-text' : 'text-text-muted opacity-55'
        }`}
      >
        <Pin fill="var(--color-clay)" />
        <span className="text-[12px] font-semibold">{t('map.legendVisited')}</span>
      </button>
      <button
        onClick={() => toggle('wishlist')}
        aria-pressed={wishOn}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-all ${
          wishOn ? 'bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-text' : 'text-text-muted opacity-55'
        }`}
      >
        <Pin fill="var(--color-olive)" hollow />
        <span className="text-[12px] font-semibold">{t('map.legendWish')}</span>
      </button>
    </div>
  )
}

/**
 * La legende reutilise le dessin des marqueurs, pas une copie : une pastille
 * qui ne ressemble pas au marqueur ne legende rien.
 */
function Pin({ fill, hollow = false }: { fill: string; hollow?: boolean }) {
  return (
    <span
      aria-hidden
      className="inline-block leading-none"
      dangerouslySetInnerHTML={{ __html: pinSvg(fill, hollow, false, 0.62) }}
    />
  )
}
