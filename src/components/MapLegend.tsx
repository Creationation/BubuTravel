import { useT } from '../i18n/I18nContext'
import { pinSvg } from './mapIcon'

/**
 * Legende des marqueurs. Deux etats seulement, mais ils portent une
 * information : sans legende, rien ne dit qu'olive veut dire « pas encore
 * vu ». La couleur et la forme du coeur sont reprises telles quelles.
 */
export default function MapLegend() {
  const t = useT()

  return (
    <div className="panel flex items-center gap-4 px-3 py-2 shadow-lg">
      <span className="flex items-center gap-1.5">
        <Pin fill="var(--color-clay)" />
        <span className="text-[11px] text-text-soft">{t('map.legendVisited')}</span>
      </span>
      <span className="flex items-center gap-1.5">
        <Pin fill="var(--color-olive)" hollow />
        <span className="text-[11px] text-text-soft">{t('map.legendWish')}</span>
      </span>
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
