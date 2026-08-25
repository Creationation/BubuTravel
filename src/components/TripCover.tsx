import { useEffect, useState } from 'react'
import { signPhotoUrls } from '../lib/api'
import { useT } from '../i18n/I18nContext'

/**
 * Une couverture peut etre une adresse web collee a la main, ou un chemin
 * vers une photo du carnet. Ce second cas est le seul durable : une URL
 * signee expire au bout d'une heure, la stocker telle quelle donnerait une
 * image morte des le lendemain. On stocke donc le chemin, et on signe a
 * l'affichage.
 */
const cache = new Map<string, string>()

export function isStoragePath(value: string): boolean {
  return !/^https?:\/\//i.test(value)
}

export function useCoverUrl(coverUrl: string | null): string | null {
  const [url, setUrl] = useState<string | null>(() => {
    if (!coverUrl) return null
    if (!isStoragePath(coverUrl)) return coverUrl
    return cache.get(coverUrl) ?? null
  })

  useEffect(() => {
    if (!coverUrl) {
      setUrl(null)
      return
    }
    if (!isStoragePath(coverUrl)) {
      setUrl(coverUrl)
      return
    }
    const cached = cache.get(coverUrl)
    if (cached) {
      setUrl(cached)
      return
    }
    let active = true
    signPhotoUrls([coverUrl])
      .then((map) => {
        const signed = map[coverUrl]
        if (!signed) return
        cache.set(coverUrl, signed)
        if (active) setUrl(signed)
      })
      .catch(() => {
        // Une couverture absente ne doit pas casser la page
      })
    return () => {
      active = false
    }
  }, [coverUrl])

  return url
}

export default function TripCover({
  coverUrl,
  className = '',
}: {
  coverUrl: string | null
  className?: string
}) {
  const url = useCoverUrl(coverUrl)
  const t = useT()

  if (!url) {
    return (
      <div className={`flex items-center justify-center bg-surface-2 ${className}`}>
        <span className="eyebrow">{t('trips.noCover')}</span>
      </div>
    )
  }
  return <img src={url} alt="" loading="lazy" className={`h-full w-full object-cover ${className}`} />
}
