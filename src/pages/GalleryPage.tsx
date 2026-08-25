import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { usePlaces } from '../context/PlacesContext'
import { fetchAllPhotos, signPhotoUrls } from '../lib/api'
import type { Photo } from '../lib/types'
import AppShell from '../components/AppShell'
import Reveal from '../components/Reveal'
import { plural } from '../lib/stats'
import Lightbox from '../components/Lightbox'
import { errorMessage } from '../lib/errors'

type Filter = { kind: 'all' } | { kind: 'country'; value: string } | { kind: 'trip'; value: string }

export default function GalleryPage() {
  const { user } = useAuth()
  const { places, trips, countries } = usePlaces()
  const [photos, setPhotos] = useState<Photo[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>({ kind: 'all' })
  const [zoom, setZoom] = useState<number | null>(null)

  useEffect(() => {
    if (!user) return
    let active = true
    setLoading(true)
    fetchAllPhotos(user.id)
      .then(async (list) => {
        if (!active) return
        setPhotos(list)
        const signed = await signPhotoUrls(list.map((p) => p.url))
        if (active) setUrls(signed)
      })
      .catch((err) => active && setError(errorMessage(err)))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [user])

  const placeById = useMemo(() => new Map(places.map((p) => [p.id, p])), [places])

  const visible = useMemo(() => {
    return photos.filter((photo) => {
      const place = placeById.get(photo.place_id)
      if (!place) return filter.kind === 'all'
      if (filter.kind === 'country') return place.country === filter.value
      if (filter.kind === 'trip') return place.trip_id === filter.value
      return true
    })
  }, [photos, filter, placeById])

  const gallery = visible.map((p) => urls[p.url]).filter(Boolean)

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-6xl px-5 pb-24 sm:px-8">
        <section className="border-b border-line py-12 sm:py-16">
          <Reveal>
            <p className="eyebrow">Galerie</p>
            <h1 className="display mt-4 text-[clamp(2.2rem,6vw,4rem)]">
              {plural(photos.length, 'photo')}
            </h1>
            <p className="lede mt-5 max-w-xl">
              Toutes les photos du carnet, du plus recent au plus ancien. Filtrez par pays ou par
              voyage, cliquez pour voir en grand.
            </p>
          </Reveal>
        </section>

        {/* Filtres */}
        <Reveal className="mt-8 flex flex-wrap gap-2">
          <button
            onClick={() => setFilter({ kind: 'all' })}
            className={`pill ${filter.kind === 'all' ? 'pill-active' : ''}`}
          >
            Tout
          </button>
          {countries.map((country) => (
            <button
              key={country}
              onClick={() => setFilter({ kind: 'country', value: country })}
              className={`pill ${
                filter.kind === 'country' && filter.value === country ? 'pill-active' : ''
              }`}
            >
              {country}
            </button>
          ))}
          {trips.map((trip) => (
            <button
              key={trip.id}
              onClick={() => setFilter({ kind: 'trip', value: trip.id })}
              className={`pill ${
                filter.kind === 'trip' && filter.value === trip.id ? 'pill-active' : ''
              }`}
            >
              {trip.title}
            </button>
          ))}
        </Reveal>

        {error && <p className="notice notice-bad mt-6">{error}</p>}

        {loading ? (
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="arch-soft aspect-[4/5] animate-pulse bg-surface-2" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="panel mt-10 px-8 py-14 text-center">
            <h2 className="display-sm text-2xl">Aucune photo ici</h2>
            <p className="lede mx-auto mt-3 max-w-md">
              Les photos s'ajoutent depuis le panneau d'un lieu, sur la carte.
            </p>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {visible.map((photo, i) => {
              const place = placeById.get(photo.place_id)
              const url = urls[photo.url]
              return (
                <Reveal key={photo.id} delay={Math.min(i * 25, 300)}>
                  <button
                    onClick={() => setZoom(i)}
                    className="arch-soft group relative block aspect-[4/5] w-full border border-line bg-surface-2"
                  >
                    {url ? (
                      <img
                        src={url}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                      />
                    ) : (
                      <span className="block h-full w-full animate-pulse bg-surface-2" />
                    )}
                    {place && (
                      <span className="absolute inset-x-0 bottom-0 translate-y-full bg-gradient-to-t from-bg-deep/90 to-transparent px-3 py-2.5 text-left text-[12px] text-text transition-transform duration-300 group-hover:translate-y-0">
                        <span className="block truncate font-medium">{place.name}</span>
                        <span className="block truncate text-text-muted">{place.country}</span>
                      </span>
                    )}
                  </button>
                </Reveal>
              )
            })}
          </div>
        )}
      </div>

      {zoom !== null && gallery.length > 0 && (
        <Lightbox
          urls={gallery}
          index={Math.min(zoom, gallery.length - 1)}
          onIndexChange={setZoom}
          onClose={() => setZoom(null)}
          caption={(() => {
            const photo = visible[Math.min(zoom, visible.length - 1)]
            const place = photo ? placeById.get(photo.place_id) : null
            return place ? `${place.name}, ${place.country}` : undefined
          })()}
        />
      )}
    </AppShell>
  )
}
