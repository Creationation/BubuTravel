import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePlaces } from '../context/PlacesContext'
import { fetchAllPhotos, signPhotoUrls } from '../lib/api'
import { formatDate, formatKm, formatRange, groupByYear, plural } from '../lib/stats'
import type { Place } from '../lib/types'
import AppShell, { Avatar } from '../components/AppShell'
import Reveal from '../components/Reveal'
import TripCover from '../components/TripCover'
import { useI18n } from '../i18n/I18nContext'

export default function Dashboard() {
  const { user, profile } = useAuth()
  const { places, visited, wishlist, trips, countries, stats, loading, error } = usePlaces()
  const [covers, setCovers] = useState<Record<string, string>>({})
  const { t, locale } = useI18n()

  const name = profile?.display_name || user?.email?.split('@')[0] || t('common.traveller')

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
            <p className="eyebrow">{t('journal.eyebrow')}</p>
            <div className="mt-5 flex flex-wrap items-end justify-between gap-6">
              <h1 className="display max-w-2xl text-[clamp(2.6rem,7vw,5rem)]">
                {t('journal.title', { name })}
              </h1>
              <Link to="/profil" className="flex items-center gap-3">
                <Avatar url={profile?.avatar_url} name={name} size={44} />
                <span className="text-[13px] text-text-muted underline-offset-4 hover:underline">
                  {t('journal.editProfile')}
                </span>
              </Link>
            </div>
            <p className="lede mt-6 max-w-xl">
              {stats.countries > 0
                ? `${plural(stats.countries, t('unit.country'), t('unit.country'))}, ${plural(stats.cities, t('unit.city'))}, ${formatKm(
                    stats.km,
                  )} ${stats.km > 1 ? 'kilometres parcourus' : 'kilometre parcouru'}${
                    stats.firstYear ? ` depuis ${stats.firstYear}` : ''
                  }.`
                : t('journal.firstPlace')}
            </p>
            <div className="mt-8 flex flex-wrap gap-2.5">
              <Link to="/carte" className="btn btn-accent">
                {t('journal.openMap')}
              </Link>
              <Link to="/voyages" className="btn">
                {t('journal.myTrips')}
              </Link>
              <Link to="/bucketlist" className="btn">
                {t('nav.wishlist')}
                {wishlist.length > 0 ? ` (${wishlist.length})` : ''}
              </Link>
              <Link to="/galerie" className="btn">
                {t('nav.gallery')}
              </Link>
            </div>
          </Reveal>
        </section>

        {error && <p className="notice notice-bad mt-8">{error}</p>}

        {/* Compteurs */}
        <section className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4">
          <Stat label={t('stat.countries')} value={stats.countries} delay={0} />
          <Stat label={t('stat.cities')} value={stats.cities} delay={60} />
          <Stat label={t('stat.photos')} value={stats.photos} delay={120} />
          <Stat
            label={t('stat.kilometres')}
            value={formatKm(stats.km)}
            hint={t('stat.asCrowFlies')}
            delay={180}
          />
        </section>

        {empty && (
          <Reveal className="mt-10">
            <div className="panel px-8 py-14 text-center">
              <h2 className="display-sm text-2xl">{t('journal.emptyTitle')}</h2>
              <p className="lede mx-auto mt-3 max-w-md">{t('journal.emptyBody')}</p>
              <Link to="/carte" className="btn btn-accent mt-7">
                {t('journal.addPlace')}
              </Link>
            </div>
          </Reveal>
        )}

        {/* Voyages recents */}
        {trips.length > 0 && (
          <section className="mt-16">
            <Reveal className="mb-6 flex items-baseline justify-between gap-4">
              <div>
                <p className="eyebrow">{t('journal.recentTrips')}</p>
                <h2 className="display-sm mt-2 text-3xl">{t('journal.byTrip')}</h2>
              </div>
              <Link to="/voyages" className="text-[13px] text-text-muted hover:text-text">
                {t('common.seeAll')}
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
                      <div className="arch aspect-[16/11] bg-surface-2">
                        <TripCover coverUrl={trip.cover_url} className="h-full w-full" />
                      </div>
                      <div className="p-5">
                        <h3 className="display-sm text-xl">{trip.title}</h3>
                        <p className="mt-1.5 text-[13px] text-text-muted">
                          {formatRange(trip.start_date, trip.end_date, t, locale)}
                        </p>
                        <p className="mt-3 text-[13px] text-text-soft">{plural(count, t('unit.place'), t('unit.places'))}</p>
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
              <p className="eyebrow">{t('journal.passport')}</p>
              <h2 className="display-sm mt-2 text-3xl">
                {plural(countries.length, 'pays visite', 'pays visites')}
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
              <p className="eyebrow">{t('journal.timeline')}</p>
              <h2 className="display-sm mt-2 text-3xl">{t('journal.newestFirst')}</h2>
            </Reveal>

            <div className="space-y-12">
              {years.map(({ year, items }) => (
                <div key={year}>
                  <Reveal className="mb-5 flex items-center gap-4">
                    <h3 className="display text-4xl text-text-muted">{year}</h3>
                    <span className="ornament flex-1">
                      <span className="ornament-dot" />
                    </span>
                    <span className="text-[13px] text-text-muted">
                      {plural(items.length, t('unit.place'), t('unit.places'))}
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
  const { t, locale } = useI18n()
  return (
    <Reveal as="li" delay={delay} className="bg-bg">
      <Link
        to={`/carte?lieu=${place.id}`}
        className="group flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-surface sm:gap-5 sm:px-6"
      >
        <span className="arch-soft h-14 w-14 shrink-0 border border-line bg-surface-2 sm:h-16 sm:w-16">
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
            ? formatDate(place.visit_date, { day: 'numeric', month: 'short' }, locale)
            : t('journal.noDate')}
        </span>
      </Link>
    </Reveal>
  )
}
