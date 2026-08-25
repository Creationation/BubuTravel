import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { fetchAllPhotos, signPhotoUrls } from '../lib/api'
import { errorMessage } from '../lib/errors'
import { useT } from '../i18n/I18nContext'

type Props = {
  value: string
  onChange: (value: string) => void
}

/**
 * Choix de la couverture parmi les photos deja envoyees. On enregistre le
 * chemin de stockage et non l'URL signee, qui expirerait en une heure.
 */
export default function CoverPicker({ value, onChange }: Props) {
  const t = useT()
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [paths, setPaths] = useState<string[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !user || paths.length > 0) return
    let active = true
    setLoading(true)
    fetchAllPhotos(user.id)
      .then(async (photos) => {
        const list = photos.slice(0, 60).map((p) => p.url)
        const signed = await signPhotoUrls(list)
        if (!active) return
        setPaths(list)
        setUrls(signed)
      })
      .catch((err) => active && setError(errorMessage(err)))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [open, user, paths.length])

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOpen((v) => !v)} className="btn btn-xs">
          {open ? t('common.close') : t('trips.coverPick')}
        </button>
        {value && (
          <button type="button" onClick={() => onChange('')} className="btn btn-xs btn-quiet">{t('trips.coverRemove')}</button>
        )}
      </div>

      {open && (
        <div className="mt-3">
          {error && <p className="notice notice-bad">{error}</p>}
          {loading ? (
            <p className="text-[13px] text-text-muted">{t('cover.loadingPhotos')}</p>
          ) : paths.length === 0 ? (
            <p className="text-[13px] text-text-muted">{t('cover.noPhotos')}</p>
          ) : (
            <div className="grid max-h-64 grid-cols-4 gap-2 overflow-y-auto pr-1 sm:grid-cols-6">
              {paths.map((path) => (
                <button
                  key={path}
                  type="button"
                  onClick={() => {
                    onChange(path)
                    setOpen(false)
                  }}
                  className={`arch-soft aspect-[4/5] border transition-colors ${
                    value === path ? 'border-accent' : 'border-line hover:border-line-strong'
                  }`}
                >
                  {urls[path] ? (
                    <img src={urls[path]} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <span className="block h-full w-full animate-pulse bg-surface-2" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
