import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePlaces } from '../context/PlacesContext'
import { errorMessage } from '../lib/errors'
import { formatDate, plural } from '../lib/stats'
import type { Place } from '../lib/types'
import AppShell from '../components/AppShell'
import MapCanvas from '../components/MapCanvas'
import Reveal from '../components/Reveal'
import { useT } from '../i18n/I18nContext'

type Filter = { kind: 'all' } | { kind: 'country'; value: string } | { kind: 'category'; value: string }

export default function BucketlistPage() {
  const t = useT()
  const { wishlist, categories, categoryOf, edit, remove, trips, loading } = usePlaces()
  const [filter, setFilter] = useState<Filter>({ kind: 'all' })
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const countries = useMemo(
    () => [...new Set(wishlist.map((p) => p.country).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr')),
    [wishlist],
  )

  const visible = useMemo(() => {
    if (filter.kind === 'country') return wishlist.filter((p) => p.country === filter.value)
    if (filter.kind === 'category') return wishlist.filter((p) => p.category_id === filter.value)
    return wishlist
  }, [wishlist, filter])

  /** Marquer comme visite fait basculer le lieu de la bucketlist vers le carnet. */
  async function markVisited(place: Place) {
    setBusyId(place.id)
    setError(null)
    try {
      const today = new Date()
      const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
        today.getDate(),
      ).padStart(2, '0')}`
      await edit(place.id, {
        status: 'visited',
        visit_date: place.visit_date ?? iso,
      })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-6xl px-5 pb-24 sm:px-8">
        <section className="border-b border-line py-12 sm:py-16">
          <Reveal>
            <p className="eyebrow">{t('wish.eyebrow')}</p>
            <div className="mt-4 flex flex-wrap items-end justify-between gap-5">
              <h1 className="display text-[clamp(2.2rem,6vw,4rem)]">
                {wishlist.length > 0 ? plural(wishlist.length, t('unit.wish')) : t('wish.title')}
              </h1>
              <Link to="/carte?envie=1" className="btn btn-accent">{t('map.addWish')}</Link>
            </div>
            <p className="lede mt-5 max-w-xl">{t('wish.intro')}</p>
          </Reveal>
        </section>

        {error && <p className="notice notice-bad mt-6">{error}</p>}

        {loading ? (
          <p className="mt-10 text-[13px] text-text-muted">{t('common.loading')}</p>
        ) : wishlist.length === 0 ? (
          <Reveal className="mt-10">
            <div className="panel px-8 py-14 text-center">
              <h2 className="display-sm text-2xl">{t('wish.emptyTitle')}</h2>
              <p className="lede mx-auto mt-3 max-w-md">{t('wish.emptyBody')}</p>
              <Link to="/carte?envie=1" className="btn btn-accent mt-7">{t('map.addWish')}</Link>
            </div>
          </Reveal>
        ) : (
          <>
            {/* Carte des envies */}
            <Reveal className="mt-10">
              <div className="h-[380px] overflow-hidden rounded-2xl border border-line">
                <MapCanvas
                  points={visible.map((p) => ({
                    id: p.id,
                    lat: p.lat,
                    lng: p.lng,
                    name: p.name,
                    country: p.country,
                    wish: true,
                  }))}
                  cluster={false}
                />
              </div>
            </Reveal>

            {/* Filtres */}
            <Reveal className="mt-8 flex flex-wrap gap-2">
              <button
                onClick={() => setFilter({ kind: 'all' })}
                className={`pill ${filter.kind === 'all' ? 'pill-active' : ''}`}
              >{t('common.all')}</button>
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
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setFilter({ kind: 'category', value: cat.id })}
                  className={`pill ${
                    filter.kind === 'category' && filter.value === cat.id ? 'pill-active' : ''
                  }`}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: cat.color }} />
                  {cat.name}
                </button>
              ))}
            </Reveal>

            {/* Liste */}
            <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((place, i) => {
                const cat = categoryOf(place)
                const trip = trips.find((t) => t.id === place.trip_id)
                return (
                  <Reveal as="li" key={place.id} delay={i * 50}>
                    <div className="panel lift flex h-full flex-col p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="eyebrow">{place.country}</p>
                          <h2 className="display-sm mt-1.5 truncate text-xl">{place.name}</h2>
                          {place.city && (
                            <p className="mt-0.5 text-[13px] text-text-muted">{place.city}</p>
                          )}
                        </div>
                        {cat && (
                          <span
                            className="mt-1 shrink-0 rounded-full px-2 py-0.5 text-[11px]"
                            style={{ background: `${cat.color}22`, color: cat.color }}
                          >
                            {cat.name}
                          </span>
                        )}
                      </div>

                      {place.notes && (
                        <p className="mt-3 line-clamp-3 text-[13px] leading-relaxed text-text-soft">
                          {place.notes}
                        </p>
                      )}

                      <div className="mt-3 flex flex-wrap gap-2 text-[12px] text-text-muted">
                        {place.visit_date && <span>Vise le {formatDate(place.visit_date)}</span>}
                        {trip && <span>· {trip.title}</span>}
                      </div>

                      <div className="mt-auto flex flex-wrap gap-2 pt-4">
                        <button
                          onClick={() => void markVisited(place)}
                          className="btn btn-xs btn-accent"
                          disabled={busyId === place.id}
                        >
                          {busyId === place.id ? t('common.wait') : t('wish.markVisited')}
                        </button>
                        <Link to={`/carte?lieu=${place.id}`} className="btn btn-xs">{t('common.open')}</Link>
                        <button
                          onClick={() => {
                            if (confirmId !== place.id) {
                              setConfirmId(place.id)
                              return
                            }
                            void remove(place).catch((err) => setError(errorMessage(err)))
                          }}
                          className={`btn btn-xs ${
                            confirmId === place.id ? 'border-red-500/60 text-red-400' : 'btn-quiet'
                          }`}
                        >
                          {confirmId === place.id ? t('common.confirm') : t('common.remove')}
                        </button>
                      </div>
                    </div>
                  </Reveal>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </AppShell>
  )
}
