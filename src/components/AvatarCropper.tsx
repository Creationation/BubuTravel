import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n/I18nContext'

const VIEW = 280 // diametre du cercle a l'ecran
const OUT = 720 // taille de l'image enregistree

/**
 * Recadrage de la photo de profil : on glisse la photo dans le cercle et on
 * zoome (curseur, pincement a deux doigts ou molette). Tout passe par une
 * transformation CSS, mise a jour au rythme de l'ecran : ca reste fluide.
 */
export default function AvatarCropper({
  file,
  onCancel,
  onDone,
}: {
  file: File
  onCancel: () => void
  onDone: (cropped: File) => Promise<void>
}) {
  const t = useT()
  const [src, setSrc] = useState<string | null>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  // Etat du geste hors React : pas de rendu a chaque mouvement de doigt
  const view = useRef({ x: 0, y: 0, zoom: 1 })
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; zoom: number } | null>(null)
  const frame = useRef(0)
  const [zoomUi, setZoomUi] = useState(1)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    setSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  // Echelle de base : la photo couvre tout le cercle
  const base = natural ? Math.max(VIEW / natural.w, VIEW / natural.h) : 1

  function clamp() {
    if (!natural) return
    const v = view.current
    v.zoom = Math.min(5, Math.max(1, v.zoom))
    const w = natural.w * base * v.zoom
    const h = natural.h * base * v.zoom
    const mx = Math.max(0, (w - VIEW) / 2)
    const my = Math.max(0, (h - VIEW) / 2)
    v.x = Math.min(mx, Math.max(-mx, v.x))
    v.y = Math.min(my, Math.max(-my, v.y))
  }

  function paint() {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const v = view.current
      if (imgRef.current) {
        imgRef.current.style.transform = `translate(-50%, -50%) translate3d(${v.x}px, ${v.y}px, 0) scale(${base * v.zoom})`
      }
    })
  }

  useEffect(() => {
    clamp()
    paint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [natural])

  function setZoom(z: number) {
    view.current.zoom = z
    clamp()
    paint()
    setZoomUi(view.current.zoom)
  }

  function onDown(e: React.PointerEvent) {
    ;(e.target as Element).setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.current.zoom }
    }
  }

  function onMove(e: React.PointerEvent) {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    const next = { x: e.clientX, y: e.clientY }
    pointers.current.set(e.pointerId, next)
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()]
      view.current.zoom = pinch.current.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.dist)
      setZoomUi(view.current.zoom)
    } else if (pointers.current.size === 1) {
      view.current.x += next.x - prev.x
      view.current.y += next.y - prev.y
    }
    clamp()
    paint()
  }

  function onUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
  }

  async function save() {
    if (!natural || !imgRef.current) return
    setBusy(true)
    const v = view.current
    const scale = base * v.zoom
    // Coin haut gauche du cercle, exprime en pixels de la photo d'origine
    const sx = natural.w / 2 - (VIEW / 2 + v.x) / scale
    const sy = natural.h / 2 - (VIEW / 2 + v.y) / scale
    const size = VIEW / scale
    const canvas = document.createElement('canvas')
    canvas.width = OUT
    canvas.height = OUT
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(imgRef.current, sx, sy, size, size, 0, 0, OUT, OUT)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.9))
    if (blob) await onDone(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }))
    setBusy(false)
  }

  return createPortal(
    <div className="fade-in fixed inset-0 z-[3000] flex items-end justify-center bg-[#120d09]/60 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-md rounded-t-[28px] bg-surface-solid p-6 pb-8 shadow-[var(--shadow-lg)] sm:rounded-[28px]">
        <h2 className="text-center text-[1.3rem] font-extrabold">{t('avatar.title')}</h2>
        <p className="mt-1 text-center text-[13px] text-text-muted">{t('avatar.hint')}</p>

        <div
          className="relative mx-auto mt-6 cursor-grab touch-none select-none overflow-hidden rounded-full bg-surface-2 shadow-[0_0_0_4px_var(--surface-solid),0_0_0_6px_color-mix(in_srgb,var(--accent)_45%,transparent)] active:cursor-grabbing"
          style={{ width: VIEW, height: VIEW }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onWheel={(e) => setZoom(view.current.zoom * (e.deltaY < 0 ? 1.08 : 0.93))}
        >
          {src && (
            <img
              ref={imgRef}
              src={src}
              alt=""
              draggable={false}
              onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              className="pointer-events-none absolute left-1/2 top-1/2 max-w-none origin-center will-change-transform"
              style={{ transform: 'translate(-50%, -50%)', opacity: natural ? 1 : 0, transition: 'opacity .3s ease' }}
            />
          )}
        </div>

        <div className="mt-6 flex items-center gap-3 px-2">
          <span className="text-[13px]">➖</span>
          <input
            type="range"
            min={1}
            max={5}
            step={0.01}
            value={zoomUi}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="flex-1 accent-[var(--accent)]"
            aria-label={t('avatar.zoom')}
          />
          <span className="text-[13px]">➕</span>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <button onClick={onCancel} className="btn" disabled={busy}>
            {t('common.cancel')}
          </button>
          <button onClick={() => void save()} className="btn btn-accent" disabled={busy || !natural}>
            {busy ? t('common.saving') : t('avatar.use')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
