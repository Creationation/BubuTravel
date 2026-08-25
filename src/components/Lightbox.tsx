import { useCallback, useEffect } from 'react'
import { useT } from '../i18n/I18nContext'

type Props = {
  urls: string[]
  index: number
  onIndexChange: (next: number) => void
  onClose: () => void
  caption?: string
}

/** Visionneuse plein ecran, navigable au clavier et aux fleches. */
export default function Lightbox({ urls, index, onIndexChange, onClose, caption }: Props) {
  const t = useT()
  const go = useCallback(
    (delta: number) => {
      if (urls.length === 0) return
      onIndexChange((index + delta + urls.length) % urls.length)
    },
    [index, urls.length, onIndexChange],
  )

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') go(1)
      if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    // La page derriere ne doit pas defiler pendant la visionneuse
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [go, onClose])

  const url = urls[index]
  if (!url) return null

  return (
    <div
      className="fade-in fixed inset-0 z-[1500] flex flex-col bg-bg-deep/96 backdrop-blur-md"
      onClick={onClose}
    >
      <div className="flex items-center justify-between px-5 py-4 text-[13px] text-text-muted">
        <span>
          {index + 1} / {urls.length}
        </span>
        <button onClick={onClose} className="btn btn-quiet btn-xs" aria-label={t('common.close')}>{t('common.close')}</button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center px-4 pb-4">
        <img
          key={url}
          src={url}
          alt=""
          onClick={(e) => e.stopPropagation()}
          className="fade-in max-h-full max-w-full rounded-xl object-contain shadow-2xl"
        />
      </div>

      {caption && (
        <p className="px-5 pb-3 text-center text-[13px] text-text-soft">{caption}</p>
      )}

      {urls.length > 1 && (
        <div
          className="flex items-center justify-center gap-3 pb-6"
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => go(-1)} className="btn btn-icon" aria-label={t('gallery.previous')}>
            ‹
          </button>
          <button onClick={() => go(1)} className="btn btn-icon" aria-label={t('gallery.next')}>
            ›
          </button>
        </div>
      )}
    </div>
  )
}
