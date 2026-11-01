import { useLayoutEffect, useRef, useState } from 'react'
import { useT } from '../i18n/I18nContext'

/**
 * Texte long replie sur quelques lignes, avec « Voir plus » si (et seulement
 * si) il deborde vraiment. Evite qu'une note de 30 lignes mange l'ecran.
 */
export default function ClampText({
  text,
  lines = 3,
  className = '',
}: {
  text: string
  lines?: number
  className?: string
}) {
  const t = useT()
  const ref = useRef<HTMLParagraphElement>(null)
  const [open, setOpen] = useState(false)
  const [overflow, setOverflow] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || open) return
    setOverflow(el.scrollHeight > el.clientHeight + 2)
  }, [text, open, lines])

  return (
    <div>
      <p
        ref={ref}
        className={`whitespace-pre-wrap break-words ${className}`}
        style={
          open
            ? undefined
            : { display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden' }
        }
      >
        {text}
      </p>
      {(overflow || open) && (
        <button onClick={() => setOpen((v) => !v)} className="mt-1 text-[12px] font-semibold text-accent">
          {open ? t('common.showLess') : t('common.showMore')}
        </button>
      )}
    </div>
  )
}
