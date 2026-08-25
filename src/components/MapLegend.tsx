import { useT } from '../i18n/I18nContext'

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

function Pin({ fill, hollow = false }: { fill: string; hollow?: boolean }) {
  return (
    <svg viewBox="0 0 26 34" width="13" height="17" aria-hidden>
      <path
        d="M13 1.6c-6.1 0-11 4.9-11 11 0 8 9.4 18.8 9.8 19.2a1.6 1.6 0 0 0 2.4 0c.4-.4 9.8-11.2 9.8-19.2 0-6.1-4.9-11-11-11z"
        fill={fill}
        stroke="var(--bg)"
        strokeWidth="2"
      />
      {hollow ? (
        <circle cx="13" cy="12.4" r="3.9" fill="none" stroke="var(--bg)" strokeWidth="2.4" />
      ) : (
        <circle cx="13" cy="12.4" r="4.1" fill="var(--bg)" />
      )}
    </svg>
  )
}
