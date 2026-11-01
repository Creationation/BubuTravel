import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../i18n/I18nContext'

type Props = {
  urls: string[]
  index: number
  onIndexChange: (next: number) => void
  onClose: () => void
  caption?: string
  /** Fond blanc (QR codes, billets) au lieu du noir. */
  light?: boolean
}

/**
 * Visionneuse plein ecran : on glisse d'une photo a l'autre au doigt (defilement
 * natif aimante, donc parfaitement fluide), au clavier ou aux fleches.
 */
export default function Lightbox({ urls, index, onIndexChange, onClose, caption, light = false }: Props) {
  const t = useT()
  const track = useRef<HTMLDivElement>(null)
  const settling = useRef(false)
  const [scale, setScale] = useState(1)
  const [downloading, setDownloading] = useState(false)

  const changeScale = useCallback((next: number) => {
    setScale(Math.min(4, Math.max(1, next)))
  }, [])

  const downloadOriginal = useCallback(async () => {
    const url = urls[index]
    if (!url || downloading) return
    setDownloading(true)
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(String(response.status))
      const blobUrl = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      const pathname = new URL(url, window.location.href).pathname
      link.href = blobUrl
      link.download = decodeURIComponent(pathname.split('/').pop() || `bubutravel-photo-${index + 1}.jpg`)
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer')
    } finally {
      setDownloading(false)
    }
  }, [downloading, index, urls])

  const goTo = useCallback(
    (i: number, smooth = true) => {
      const el = track.current
      if (!el || urls.length === 0) return
      const next = (i + urls.length) % urls.length
      el.scrollTo({ left: next * el.clientWidth, behavior: smooth ? 'smooth' : 'auto' })
      onIndexChange(next)
    },
    [urls.length, onIndexChange],
  )

  // Position de depart, sans animation
  useEffect(() => {
    const el = track.current
    if (el) el.scrollLeft = index * el.clientWidth
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') goTo(index + 1)
      if (e.key === 'ArrowLeft') goTo(index - 1)
    }
    window.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [goTo, index, onClose])

  useEffect(() => setScale(1), [index])

  function onScroll() {
    const el = track.current
    if (!el || settling.current) return
    settling.current = true
    requestAnimationFrame(() => {
      settling.current = false
      const i = Math.round(el.scrollLeft / el.clientWidth)
      if (i !== index && i >= 0 && i < urls.length) onIndexChange(i)
    })
  }

  if (urls.length === 0) return null

  return createPortal(
    <div className={`fade-in fixed inset-0 z-[3000] flex flex-col ${light ? 'bg-white text-[#2a160d]' : 'bg-black text-white'}`}>
      <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-[calc(1rem+env(safe-area-inset-top))] text-[14px] font-semibold sm:px-5">
        <span className="num opacity-80">
          {index + 1} / {urls.length}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void downloadOriginal()}
            disabled={downloading}
            className={`rounded-full px-3 py-2 text-[12px] font-bold ${light ? 'bg-black/5' : 'bg-white/15'}`}
          >
            {downloading ? t('common.wait') : `↓ ${t('common.downloadOriginal')}`}
          </button>
          <button
            onClick={onClose}
            className={`rounded-full px-4 py-2 text-[14px] font-bold ${light ? 'bg-black/5' : 'bg-white/15'}`}
            aria-label={t('common.close')}
          >
            {t('common.close')}
          </button>
        </div>
      </div>

      <div
        ref={track}
        onScroll={onScroll}
        className="nav-scroll flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-contain"
      >
        {urls.map((u, i) => {
          const imageScale = i === index ? scale : 1
          return (
            <div key={`${u}-${i}`} className="flex h-full w-full shrink-0 snap-center snap-always items-center justify-center p-3" onClick={onClose}>
              <div className={`flex h-full w-full ${imageScale > 1 ? 'items-start justify-start overflow-auto' : 'items-center justify-center overflow-hidden'}`}>
                <img
                  src={u}
                  alt=""
                  referrerPolicy="no-referrer"
                  loading={Math.abs(i - index) <= 1 ? 'eager' : 'lazy'}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    changeScale(imageScale > 1 ? 1 : 2)
                  }}
                  className="shrink-0 select-none rounded-xl object-contain"
                  style={{
                    width: imageScale > 1 ? `${imageScale * 100}%` : '100%',
                    height: imageScale > 1 ? `${imageScale * 100}%` : '100%',
                    maxWidth: imageScale > 1 ? 'none' : '100%',
                    maxHeight: imageScale > 1 ? 'none' : '100%',
                  }}
                  draggable={false}
                />
              </div>
            </div>
          )
        })}
      </div>

      {caption && <p className="px-5 pb-2 text-center text-[13px] opacity-80">{caption}</p>}

      <div className="flex items-center justify-center gap-2 pt-2">
        <button
          onClick={() => changeScale(scale - 0.5)}
          disabled={scale <= 1}
          className={`h-11 w-11 rounded-full text-xl font-bold disabled:opacity-30 ${light ? 'bg-black/5' : 'bg-white/15'}`}
          aria-label={t('common.zoomOut')}
        >
          −
        </button>
        <button
          onClick={() => changeScale(scale === 1 ? 2 : 1)}
          className={`num min-w-16 rounded-full px-3 py-2 text-[12px] font-bold ${light ? 'bg-black/5' : 'bg-white/15'}`}
          aria-label={t('common.resetZoom')}
        >
          {Math.round(scale * 100)} %
        </button>
        <button
          onClick={() => changeScale(scale + 0.5)}
          disabled={scale >= 4}
          className={`h-11 w-11 rounded-full text-xl font-bold disabled:opacity-30 ${light ? 'bg-black/5' : 'bg-white/15'}`}
          aria-label={t('common.zoomIn')}
        >
          +
        </button>
      </div>

      {urls.length > 1 && (
        <div className="flex items-center justify-center gap-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-2">
          <button onClick={() => goTo(index - 1)} className={`h-11 w-11 rounded-full text-xl ${light ? 'bg-black/5' : 'bg-white/15'}`} aria-label={t('gallery.previous')}>
            ‹
          </button>
          <div className="flex max-w-[50vw] gap-1.5 overflow-hidden">
            {urls.slice(0, 20).map((u, i) => (
              <span key={`${u}-${i}`} className={`h-2 rounded-full transition-all duration-300 ${i === index ? 'w-5 bg-current' : 'w-2 bg-current opacity-30'}`} />
            ))}
          </div>
          <button onClick={() => goTo(index + 1)} className={`h-11 w-11 rounded-full text-xl ${light ? 'bg-black/5' : 'bg-white/15'}`} aria-label={t('gallery.next')}>
            ›
          </button>
        </div>
      )}
    </div>,
    document.body,
  )
}
