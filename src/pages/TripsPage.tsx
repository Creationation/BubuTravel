import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usePlaces } from '../context/PlacesContext'
import { formatRange, plural } from '../lib/stats'
import AppShell from '../components/AppShell'
import Reveal from '../components/Reveal'
import TripCover from '../components/TripCover'
import TripForm from '../components/TripForm'
import { useI18n } from '../i18n/I18nContext'

export default function TripsPage() {
  const { t, locale } = useI18n()
  const { trips, places, loading } = usePlaces()
  const [creating, setCreating] = useState(false)

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-6xl px-5 pb-24 sm:px-8">
        <section className="border-b border-line py-12 sm:py-16">
          <Reveal>
            <p className="eyebrow">{t('nav.trips')}</p>
            <div className="mt-4 flex flex-wrap items-end justify-between gap-5">
              <h1 className="display text-[clamp(2.2rem,6vw,4rem)]">{t('trips.title')}</h1>
              <button onClick={() => setCreating(true)} className="btn btn-accent">{t('trips.new')}</button>
            </div>
            <p className="lede mt-5 max-w-xl">{t('trips.intro')}</p>
          </Reveal>
        </section>

        {creating && (
          <div className="mt-8">
            <TripForm onDone={() => setCreating(false)} onCancel={() => setCreating(false)} />
          </div>
        )}

        {loading ? (
          <p className="mt-10 text-[13px] text-text-muted">{t('common.loading')}</p>
        ) : trips.length === 0 && !creating ? (
          <Reveal className="mt-10">
            <div className="panel px-8 py-14 text-center">
              <h2 className="display-sm text-2xl">{t('trips.emptyTitle')}</h2>
              <p className="lede mx-auto mt-3 max-w-md">{t('trips.emptyBody')}</p>
              <button onClick={() => setCreating(true)} className="btn btn-accent mt-7">{t('trips.createOne')}</button>
            </div>
          </Reveal>
        ) : (
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {trips.map((trip, i) => {
              const count = places.filter((p) => p.trip_id === trip.id).length
              const countries = new Set(
                places.filter((p) => p.trip_id === trip.id).map((p) => p.country),
              )
              return (
                <Reveal key={trip.id} delay={i * 60}>
                  <Link to={`/voyages/${trip.id}`} className="panel lift block overflow-hidden">
                    <div className="arch aspect-[16/11] bg-surface-2">
                      <TripCover coverUrl={trip.cover_url} className="h-full w-full" />
                    </div>
                    <div className="p-5">
                      <h2 className="display-sm text-xl">{trip.title}</h2>
                      <p className="mt-1.5 text-[13px] text-text-muted">
                        {trip.status === 'planning' && (
                          <span className="mr-1.5 rounded-full border border-line px-1.5 py-0.5 text-[10px]">{t('trips.toPrepare')}</span>
                        )}
                        {formatRange(trip.start_date, trip.end_date, t, locale)}
                      </p>
                      <p className="mt-3 text-[13px] text-text-soft">
                        {plural(count, t('unit.place'), t('unit.places'))}
                        {countries.size > 0 && ` · ${[...countries].join(', ')}`}
                      </p>
                    </div>
                  </Link>
                </Reveal>
              )
            })}
          </div>
        )}
      </div>
    </AppShell>
  )
}
