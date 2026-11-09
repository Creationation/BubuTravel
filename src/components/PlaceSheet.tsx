import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { usePlaces } from '../context/PlacesContext'
import { countryName } from '../lib/countryName'
import { emojiOf, familyOf, placeName } from '../lib/discover'
import { useI18n } from '../i18n/I18nContext'
import PlaceDetailsView, { PlaceHero } from './PlaceDetailsView'
import Lightbox from './Lightbox'

/**
 * Fiche d'un lieu en panneau glissant (bas de l'ecran sur telephone) :
 * on la lit, on la remplit, on la place dans le voyage, puis « Retour »
 * ramene exactement la ou l'on etait.
 */
export default function PlaceSheet({ placeId, onClose }: { placeId: string; onClose: () => void }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { places } = usePlaces()
  const place = places.find((p) => p.id === placeId)
  const [zoom, setZoom] = useState<{ urls: string[]; i: number } | null>(null)
  const [closing, setClosing] = useState(false)
  // Une fois la photo passee, les boutons du haut ont un fond plein (lisibles au-dessus du texte)
  const [scrolled, setScrolled] = useState(false)

  const close = () => {
    setClosing(true)
    window.setTimeout(onClose, 260)
  }

  // Le bouton retour du telephone ferme la fiche au lieu de quitter la page
  useEffect(() => {
    history.pushState({ sheet: placeId }, '')
    const onPop = () => close()
    window.addEventListener('popstate', onPop)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && history.back()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeId])

  if (!place) return null

  return createPortal(
    <div className="fixed inset-0 z-[2800] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div
        onClick={() => history.back()}
        className={`absolute inset-0 bg-[#120d09]/50 transition-opacity duration-300 ${closing ? 'opacity-0' : 'opacity-100'}`}
      />
      <div
        className={`sheet-in relative flex max-h-[94dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-[28px] bg-surface-solid shadow-[var(--shadow-lg)] transition-transform duration-300 sm:rounded-[28px] ${
          closing ? 'translate-y-full sm:translate-y-8 sm:opacity-0' : ''
        }`}
      >
        <div
          className={`absolute inset-x-0 top-0 z-10 flex items-center justify-between p-3 transition-colors duration-200 ${
            scrolled ? 'border-b border-line bg-surface-solid' : ''
          }`}
        >
          <button
            onClick={() => history.back()}
            className="flex h-10 items-center gap-1.5 rounded-full bg-black/45 px-3.5 text-[14px] font-bold text-white backdrop-blur-md active:scale-95"
          >
            ← {t('common.back')}
          </button>
          <button
            onClick={() => {
              onClose()
              navigate(`/carte?lieu=${place.id}`)
            }}
            className="flex h-10 items-center gap-1.5 rounded-full bg-black/45 px-3.5 text-[13px] font-bold text-white backdrop-blur-md active:scale-95"
          >
            🗺️ {t('ov.seeMap')}
          </button>
        </div>
        <div className="overflow-y-auto overscroll-contain" onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 150)}>
          <PlaceHero place={place} onZoom={(urls, i) => setZoom({ urls, i })} />
          {!(place.gallery?.length || place.image_url) && <div className="h-16" />}
          <div className="space-y-4 p-5 pb-[calc(2rem+env(safe-area-inset-bottom))]">
            <div>
              <p className="text-[13px] font-semibold text-text-muted">
                {emojiOf(familyOf(place))} {[place.city, countryName(place.country)].filter(Boolean).join(', ')}
              </p>
              <h2 className="mt-1 text-[1.6rem] font-extrabold leading-tight">{placeName(place)}</h2>
            </div>
            <PlaceDetailsView place={place} />
          </div>
        </div>
      </div>
      {zoom && <Lightbox urls={zoom.urls} index={zoom.i} onIndexChange={(i) => setZoom({ urls: zoom.urls, i })} onClose={() => setZoom(null)} />}
    </div>,
    document.body,
  )
}
