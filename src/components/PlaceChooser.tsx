import { useEffect } from 'react'
import { useT } from '../i18n/I18nContext'
import { usePlaces } from '../context/PlacesContext'
import { pinSvg } from './mapIcon'
import type { Place } from '../lib/types'

type Props = {
  places: Place[]
  onPick: (place: Place) => void
  onClose: () => void
}

/**
 * Plusieurs lieux se superposent sous le clic : plutot que d'en ouvrir un au
 * hasard, on demande lequel. C'est le prix de la zone cliquable elargie, qui
 * rend les marqueurs faciles a viser mais peut en attraper deux a la fois.
 *
 * La liste montre ce qui les distingue vraiment, le nom et la ville, pas
 * seulement le pays : deux lieux au meme endroit partagent forcement le pays.
 */
export default function PlaceChooser({ places, onPick, onClose }: Props) {
  const t = useT()
  const { categoryOf } = usePlaces()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fade-in fixed inset-0 z-[1300] flex items-center justify-center bg-bg-deep/70 p-5 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="panel w-full max-w-sm overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <header className="border-b border-line px-5 pb-4 pt-5">
          <p className="eyebrow">{t('map.overlap')}</p>
          <h2 className="display-sm mt-2 text-2xl">{t('map.whichPlace')}</h2>
        </header>

        <ul className="max-h-[50vh] divide-y divide-line overflow-y-auto">
          {places.map((place) => {
            const cat = categoryOf(place)
            const wish = place.status === 'wishlist'
            return (
              <li key={place.id}>
                <button
                  onClick={() => onPick(place)}
                  className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-surface-2"
                >
                  <span
                    aria-hidden
                    className="shrink-0 leading-none"
                    dangerouslySetInnerHTML={{
                      __html: pinSvg(
                        wish ? 'var(--color-olive)' : 'var(--color-clay)',
                        wish,
                        false,
                        0.68,
                      ),
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="display-sm block truncate text-lg">{place.name}</span>
                    <span className="mt-0.5 block truncate text-[13px] text-text-muted">
                      {place.city ? `${place.city}, ` : ''}
                      {place.country}
                      {cat && ` · ${cat.name}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] text-text-muted">
                    {wish ? t('map.legendWish') : t('map.legendVisited')}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>

        <footer className="border-t border-line px-5 py-3">
          <button onClick={onClose} className="btn btn-xs btn-quiet w-full">
            {t('common.cancel')}
          </button>
        </footer>
      </div>
    </div>
  )
}
