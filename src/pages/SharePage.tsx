import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { fetchSharedData, signPhotoUrls } from '../lib/api'
import type { SharedData } from '../lib/api'
import { buildStats, formatDate, formatKm, formatRange, groupByYear } from '../lib/stats'
import MapCanvas from '../components/MapCanvas'
import Reveal from '../components/Reveal'
import Lightbox from '../components/Lightbox'
import ThemeToggle from '../components/ThemeToggle'
import { Avatar } from '../components/AppShell'
import type { Place } from '../lib/types'
import { errorMessage } from '../lib/errors'

/**
 * Vue publique en lecture seule. Aucun compte n'est requis : tout passe par
 * les fonctions security definer, qui n'acceptent que le jeton du lien.
 * Rien n'est modifiable ici, et l'email du proprietaire n'est jamais renvoye.
 */
export default function SharePage() {
  const { token = '' } = useParams()
  const [data, setData] = useState<SharedData | null>(null)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState<{ urls: string[]; index: number } | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchSharedData(token)
      .then(async (result) => {
        if (!active) return
        setData(result)
        const signed = await signPhotoUrls(result.photos.map((p) => p.url))
        if (active) setUrls(signed)
      })
      .catch((err) => active && setError(errorMessage(err)))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [token])

  const photosByPlace = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const photo of data?.photos ?? []) {
      const url = urls[photo.url]
      if (!url) continue
      map[photo.place_id] = [...(map[photo.place_id] ?? []), url]
    }
    return map
  }, [data, urls])

  if (loading) {
    return (
      <Frame>
        <p className="text-[13px] text-text-muted">Ouverture du carnet...</p>
      </Frame>
    )
  }

  if (error || !data || !data.profile) {
    return (
      <Frame>
        <h1 className="display-sm text-3xl">Ce lien ne fonctionne plus</h1>
        <p className="lede mx-auto mt-3 max-w-md">
          Le partage a peut-etre ete desactive ou regenere par son proprietaire.
        </p>
      </Frame>
    )
  }

  const name = data.profile.display_name || 'Un voyageur'
  // Les vues partagees n'ont pas de user_id, on complete pour reutiliser les calculs
  const places = data.places.map((p) => ({ ...p, user_id: '', created_at: '' })) as Place[]
  const stats = buildStats(places, data.photos.length)
  const years = groupByYear(places)

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-[900] border-b border-line bg-bg/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5 sm:px-8">
          <span className="h-2 w-2 rounded-full bg-accent" />
          <span className="display-sm text-xl">BuBuTravel</span>
          <span className="pill ml-2 hidden sm:inline-flex">Lecture seule</span>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-5 pb-24 sm:px-8">
        <section className="border-b border-line py-14 sm:py-20">
          <Reveal>
            <div className="flex items-center gap-4">
              <Avatar url={data.profile.avatar_url} name={name} size={52} />
              <p className="eyebrow mb-0">Le carnet de {name}</p>
            </div>
            <h1 className="display mt-6 text-[clamp(2.4rem,7vw,4.6rem)]">
              {stats.countries} pays, {stats.places} lieux
            </h1>
            <p className="lede mt-5 max-w-xl">
              {formatKm(stats.km)} kilometres a vol d'oiseau, {stats.photos} photos
              {stats.firstYear ? `, depuis ${stats.firstYear}` : ''}.
            </p>
          </Reveal>
        </section>

        {places.length > 0 && (
          <Reveal className="mt-10">
            <div className="h-[460px] overflow-hidden rounded-2xl border border-line">
              <MapCanvas
                points={places.map((p) => ({
                  id: p.id,
                  lat: p.lat,
                  lng: p.lng,
                  name: p.name,
                  country: p.country,
                }))}
              />
            </div>
          </Reveal>
        )}

        {data.trips.length > 0 && (
          <section className="mt-16">
            <Reveal className="mb-6">
              <p className="eyebrow">Voyages</p>
            </Reveal>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {data.trips.map((trip, i) => (
                <Reveal key={trip.id} delay={i * 60}>
                  <div className="panel overflow-hidden">
                    <div className="aspect-[16/10] bg-surface-2">
                      {trip.cover_url && (
                        <img
                          src={trip.cover_url}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <div className="p-5">
                      <h3 className="display-sm text-xl">{trip.title}</h3>
                      <p className="mt-1.5 text-[13px] text-text-muted">
                        {formatRange(trip.start_date, trip.end_date)}
                      </p>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </section>
        )}

        <section className="mt-16 space-y-12">
          {years.map(({ year, items }) => (
            <div key={year}>
              <Reveal className="mb-5 flex items-center gap-4">
                <h3 className="display text-4xl text-text-muted">{year}</h3>
                <span className="h-px flex-1 bg-line" />
              </Reveal>
              <div className="space-y-8">
                {items.map((place, i) => {
                  const gallery = photosByPlace[place.id] ?? []
                  return (
                    <Reveal key={place.id} delay={i * 50}>
                      <article className="border-b border-line pb-8">
                        <p className="eyebrow">
                          {place.visit_date ? formatDate(place.visit_date) : 'Sans date'}
                        </p>
                        <h4 className="display-sm mt-2 text-2xl">{place.name}</h4>
                        <p className="mt-1 text-[13px] text-text-muted">
                          {place.city ? `${place.city}, ` : ''}
                          {place.country}
                        </p>
                        {place.notes && (
                          <p className="mt-3 max-w-2xl whitespace-pre-wrap text-[14px] leading-relaxed text-text-soft">
                            {place.notes}
                          </p>
                        )}
                        {gallery.length > 0 && (
                          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                            {gallery.map((url, k) => (
                              <button
                                key={url}
                                onClick={() => setZoom({ urls: gallery, index: k })}
                                className="aspect-[4/3] overflow-hidden rounded-xl border border-line"
                              >
                                <img
                                  src={url}
                                  alt=""
                                  loading="lazy"
                                  className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
                                />
                              </button>
                            ))}
                          </div>
                        )}
                      </article>
                    </Reveal>
                  )
                })}
              </div>
            </div>
          ))}
        </section>
      </div>

      {zoom && (
        <Lightbox
          urls={zoom.urls}
          index={zoom.index}
          onIndexChange={(index) => setZoom({ ...zoom, index })}
          onClose={() => setZoom(null)}
        />
      )}
    </div>
  )
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center px-5 text-center">
      <div>{children}</div>
    </div>
  )
}
