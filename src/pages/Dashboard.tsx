import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePlaces } from '../context/PlacesContext'
import { fetchAllPhotos, signPhotoUrls } from '../lib/api'
import { formatDate, formatKm, formatRange, groupByYear } from '../lib/stats'
import type { Place } from '../lib/types'
import AppShell, { Avatar } from '../components/AppShell'
import Reveal from '../components/Reveal'

export default function Dashboard() {
  const { user, profile } = useAuth()
  const { places, visited, wishlist, trips, countries, stats, loading, error } = usePlaces()
  const [covers, setCovers] = useState<Record<string, string>>({})

  const name = profile?.display_name || user?.email?.split('@')[0] || 'Voyageur'

  // Une photo par lieu, pour illustrer la timeline sans charger la galerie
  useEffect(() => {
    if (!user) return
    let active = true
    fetchAllPhotos(user.id)
      .then(async (photos) => {
        const firstByPlace = new Map<string, string>()
        for (const photo of photos) {
          if (!firstByPlace.has(photo.place_id)) firstByPlace.set(photo.place_id, photo.url)
        }
        const signed = await signPhotoUrls([...firstByPlace.values()])
        if (!active) return
        const map: Record<string, string> = {}
        for (const [placeId, path] of firstByPlace) {
          if (signed[path]) map[placeId] = signed[path]
        }
        setCovers(map)
      })
      .catch(() => {
        // La timeline reste lisible sans ses vignettes
      })
    return () => {
      active = false
    }
  }, [user])

  const years = useMemo(() => groupByYear(visited), [visited])
  const topCountries = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of visited) counts.set(p.country, (counts.get(p.country) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [visited])

  const empty = !loading && places.length === 0

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-6xl px-5 pb-24 sm:px-8">
        {/* En-tete editorial */}
        <section className="border-b border-line py-14 sm:py-20">
          <Reveal>
            <p className="eyebrow">Carnet de voyage</p>
            <div className="mt-5 flex flex-wrap items-end justify-between gap-6">
              <h1 className="display max-w-2xl text-[clamp(2.6rem,7vw,5rem)]">
                Les voyages de {name}
              </h1>
              <Link to="/profil" className="flex items-center gap-3">
                <Avatar url={profile?.avatar_url} name={name} size={44} />
                <span className="text-[13px] text-text-muted underline-offset-4 hover:underline">
                  Modifier le profil
                </span>
              </Link>
            </div>
            <p className="lede mt-6 max-w-xl">
              {stats.countries > 0
                ? `${stats.countries} pays, ${stats.cities} villes, ${formatKm(stats.km)} kilometres parcourus${
                    stats.firstYear ? ` depuis ${stats.firstYear}` : ''
                  }.`
                : 'Tout commence par un premier lieu sur la carte.'}
            </p>
            <div className="mt-8 flex flex-wrap gap-2.5">
              <Link to="/carte" className="btn btn-accent">
                Ouvrir la carte
              </Link>
              <Link to="/voyages" className="btn">
                Mes voyages
              </Link>
              <Link to="/bucketlist" className="btn">
                Envies{wishlist.length > 0 ? ` (${wishlist.length})` : ''}
              </Link>
              <Link to="/galerie" className="btn">
                Galerie
              </Link>
            </div>
          </Reveal>
        </section>

        {error && <p className="notice notice-bad mt-8">{error}</p>}

        {/* Compteurs */}
        <section className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4">
          <Stat label="Pays" value={stats.countries} delay={0} />
          <Stat label="Villes" value={stats.cities} delay={60} />
          <Stat label="Photos" value={stats.photos} delay={120} />
          <Stat label="Kilometres" value={formatKm(stats.km)} hint="a vol d'oiseau" delay={180} />
        </section>

        {empty && (
          <Reveal className="mt-10">
            <div className="panel px-8 py-14 text-center">
              <h2 className="display-sm text-2xl">Le carnet est encore vierge</h2>
              <p className="lede mx-auto mt-3 max-w-md">
                Ajoutez un premier lieu depuis la carte : une recherche d'adresse, ou un simple
                clic sur le point qui vous interesse.
              </p>
              <Link to="/carte" className="btn btn-accent mt-7">
                Ajouter un lieu
              </Link>
            </div>
          </Reveal>
        )}

        {/* Voyages recents */}
        {trips.length > 0 && (
          <section className="mt-16">
            <Reveal className="mb-6 flex items-baseline justify-between gap-4">
              <div>
                <p className="eyebrow">Derniers voyages</p>
                <h2 className="display-sm mt-2 text-3xl">Par deplacement</h2>
              </div>
              <Link to="/voyages" className="text-[13px] text-text-muted hover:text-text">
                Tout voir
              </Link>
            </Reveal>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {trips.slice(0, 3).map((trip, i) => {
                const count = places.filter((p) => p.trip_id === trip.id).length
                return (
                  <Reveal key={trip.id} delay={i * 70}>
                    <Link
                      to={`/voyages/${trip.id}`}
                      className="panel lift block overflow-hidden"
                    >
                      <div className="aspect-[16/10] overflow-hidden bg-surface-2">
                        {trip.cover_url ? (
                          <img
                            src={trip.cover_url}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-text-muted">
                            <span className="eyebrow">Sans couverture</span>
                          </div>
                        )}
                      </div>
                      <div className="p-5">
                        <h3 className="display-sm text-xl">{trip.title}</h3>
                        <p className="mt-1.5 text-[13px] text-text-muted">
                          {formatRange(trip.start_date, trip.end_date)}
                        </p>
                        <p className="mt-3 text-[13px] text-text-soft">
                          {count} lieu{count > 1 ? 'x' : ''}
                        </p>
                      </div>
                    </Link>
                  </Reveal>
                )
              })}
            </div>
          </section>
        )}

        {/* Pays */}
        {topCountries.length > 0 && (
          <section className="mt-16">
            <Reveal className="mb-6">
              <p className="eyebrow">Passeport</p>
              <h2 className="display-sm mt-2 text-3xl">
                {countries.length} pays visite{countries.length > 1 ? 's' : ''}
              </h2>
            </Reveal>
            <Reveal className="flex flex-wrap gap-2">
              {topCountries.map(([country, count]) => (
                <span key={country} className="pill">
                  {country}
                  <span className="text-text-muted">{count}</span>
                </span>
              ))}
            </Reveal>
          </section>
        )}

        {/* Timeline generale */}
        {years.length > 0 && (
          <section className="mt-16">
            <Reveal className="mb-8">
              <p className="eyebrow">Chronologie</p>
              <h2 className="display-sm mt-2 text-3xl">Du plus recent au plus ancien</h2>
            </Reveal>

            <div className="space-y-12">
              {years.map(({ year, items }) => (
                <div key={year}>
                  <Reveal className="mb-5 flex items-center gap-4">
                    <h3 className="display text-4xl text-text-muted">{year}</h3>
                    <span className="h-px flex-1 bg-line" />
                    <span className="text-[13px] text-text-muted">
                      {items.length} lieu{items.length > 1 ? 'x' : ''}
                    </span>
                  </Reveal>

                  <ul className="space-y-px overflow-hidden rounded-2xl border border-line bg-line">
                    {items.map((place, i) => (
                      <TimelineRow
                        key={place.id}
                        place={place}
                        cover={covers[place.id]}
                        tripTitle={trips.find((t) => t.id === place.trip_id)?.title}
                        delay={Math.min(i * 45, 260)}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  )
}

function Stat({
  label,
  value,
  hint,
  delay,
}: {
  label: string
  value: number | string
  hint?: string
  delay: number
}) {
  return (
    <Reveal delay={delay} className="bg-bg">
      <div className="px-5 py-7 sm:px-7 sm:py-9">
        <p className="display text-[clamp(2.2rem,5vw,3.2rem)]">{value}</p>
        <p className="eyebrow mt-2">{label}</p>
        {hint && <p className="mt-1 text-[11px] text-text-muted/70">{hint}</p>}
      </div>
    </Reveal>
  )
}

function TimelineRow({
  place,
  cover,
  tripTitle,
  delay,
}: {
  place: Place
  cover?: string
  tripTitle?: string
  delay: number
}) {
  return (
    <Reveal as="li" delay={delay} className="bg-bg">
      <Link
        to={`/carte?lieu=${place.id}`}
        className="group flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-surface sm:gap-5 sm:px-6"
      >
        <span className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-line bg-surface-2 sm:h-16 sm:w-16">
          {cover ? (
            <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center">
              <span className="h-1.5 w-1.5 rounded-full bg-line-strong" />
            </span>
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="display-sm block truncate text-lg group-hover:text-accent">
            {place.name}
          </span>
          <span className="mt-0.5 block truncate text-[13px] text-text-muted">
            {place.country}
            {tripTitle && ` · ${tripTitle}`}
          </span>
        </span>

        <span className="shrink-0 text-right text-[13px] text-text-muted">
          {place.visit_date
            ? formatDate(place.visit_date, { day: 'numeric', month: 'short' })
            : 'sans date'}
        </span>
      </Link>
    </Reveal>
  )
}
