import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { usePlaces } from '../context/PlacesContext'
import { useAuth } from '../context/AuthContext'
import { fetchAllPhotos, signPhotoUrls } from '../lib/api'
import { formatDate, formatRange, totalDistanceKm } from '../lib/stats'
import { formatDuration } from '../lib/geolocation'
import { countdown, daysBetween } from '../lib/tripDates'
import { buildTripIcs, downloadIcs } from '../lib/ics'
import { useTripHub } from '../lib/useTripHub'
import AppShell, { Avatar } from '../components/AppShell'
import MapCanvas from '../components/MapCanvas'
import Reveal from '../components/Reveal'
import TripForm from '../components/TripForm'
import TripPlanner from '../components/TripPlanner'
import Lightbox from '../components/Lightbox'
import PlaceChooser from '../components/PlaceChooser'
import { useCoverUrl } from '../components/TripCover'
import Overview from '../components/hub/Overview'
import type { HubTab } from '../components/hub/Overview'
import RouteTab from '../components/hub/RouteTab'
import TodoTab from '../components/hub/TodoTab'
import DocsTab from '../components/hub/DocsTab'
import SharePanel from '../components/hub/SharePanel'
import TripAssistant from '../components/hub/TripAssistant'
import IdeasTab from '../components/hub/IdeasTab'
import { MODES, modeKey } from '../components/hub/StopForm'
import { CalendarIcon, ShareIcon, SparkIcon } from '../components/hub/icons'
import { useI18n } from '../i18n/I18nContext'
import type { Key } from '../i18n/fr'
import type { TransportMode } from '../lib/types'

const TABS: { id: HubTab; label: Key }[] = [
  { id: 'overview', label: 'hub.tab.overview' },
  { id: 'route', label: 'hub.tab.route' },
  { id: 'todo', label: 'hub.tab.todo' },
  { id: 'docs', label: 'hub.tab.docs' },
  { id: 'ideas', label: 'hub.tab.ideas' },
  { id: 'memories', label: 'hub.tab.memories' },
]

/**
 * Le carnet de route d'un voyage : en-tete avec compte a rebours, puis des
 * onglets pour l'itineraire, les choses a faire, les documents, les idees
 * venues des reseaux et les souvenirs (lieux, photos, parcours).
 */
export default function TripView() {
  const { t, locale } = useI18n()
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { trips, loading } = usePlaces()
  const hub = useTripHub(id)
  const [editing, setEditing] = useState(false)
  const [sharing, setSharing] = useState(false)
  // ?assistant=1 : on revient d'un brouillon de l'assistant
  const [assistant, setAssistant] = useState(() => params.get('assistant') === '1')

  const autoAdd = params.get('ajout') === '1'
  const tab = (TABS.find((x) => x.id === params.get('onglet'))?.id ?? 'overview') as HubTab
  const go = (next: HubTab) => {
    setParams(next === 'overview' ? {} : { onglet: next }, { replace: true })
    window.scrollTo({ top: Math.min(window.scrollY, 380), behavior: 'smooth' })
  }

  const trip = trips.find((x) => x.id === id)
  const cover = useCoverUrl(trip?.cover_url ?? null)

  if (loading) {
    return (
      <AppShell>
        <p className="mx-auto max-w-6xl px-5 py-16 text-[13px] text-text-muted">{t('common.loading')}</p>
      </AppShell>
    )
  }

  if (!trip) {
    return (
      <AppShell>
        <div className="mx-auto max-w-6xl px-5 py-20 text-center sm:px-8">
          <h1 className="display-sm text-3xl">{t('trips.notFound')}</h1>
          <p className="lede mt-3">{t('trips.maybeDeleted')}</p>
          <Link to="/voyages" className="btn mt-6">{t('trips.backToTrips')}</Link>
        </div>
      </AppShell>
    )
  }

  const cd = countdown(trip.start_date, trip.end_date)
  const totalDays = trip.start_date && trip.end_date ? daysBetween(trip.start_date, trip.end_date) + 1 : null
  const countries = [...new Set(hub.stops.map((s) => s.country).filter(Boolean))]
  const openTodos = hub.todos.filter((x) => !x.done).length

  function exportCalendar() {
    if (!trip) return
    const labels = Object.fromEntries(MODES.map((m) => [m, t(modeKey(m))])) as Record<TransportMode, string>
    const ics = buildTripIcs(trip, hub.stops, hub.todos, {
      stay: t('stop.stay'),
      transport: labels,
      reference: t('stop.booking'),
      todo: t('hub.tab.todo'),
    })
    downloadIcs(trip.title.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase(), ics)
  }

  return (
    <AppShell>
      {/* En-tete : couverture plein cadre, titre en grand, compte a rebours */}
      <section className="relative isolate overflow-hidden">
        <div className="absolute inset-0 -z-10">
          {cover ? (
            <>
              <img src={cover} alt="" className="h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#120d09] via-[#120d09]/55 to-[#120d09]/10" />
            </>
          ) : (
            <div className="h-full w-full bg-[radial-gradient(70%_90%_at_90%_0%,color-mix(in_srgb,var(--accent)_25%,transparent),transparent_65%)]" />
          )}
        </div>

        <div className={`mx-auto w-full max-w-6xl px-5 pb-10 pt-8 sm:px-8 sm:pb-14 ${cover ? 'text-[#fbf3e8]' : ''}`}>
          <Link
            to="/voyages"
            className={`text-[13px] ${cover ? 'text-[#fbf3e8]/75 hover:text-[#fbf3e8]' : 'text-text-muted hover:text-text'}`}
          >
            ← {t('nav.trips')}
          </Link>

          <div className={`${cover ? 'pt-28 sm:pt-40' : 'pt-10 sm:pt-14'}`}>
            <Reveal>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`chip ${cover ? 'border-white/25 bg-white/10 text-white' : 'chip-accent'}`}>
                  {trip.status === 'planning' ? t('hub.status.planning') : t('hub.status.done')}
                </span>
                {hub.people.length > 1 && (
                  <span className={`chip ${cover ? 'border-white/25 bg-white/10 text-white' : ''}`}>
                    {t('share.sharedBadge')}
                  </span>
                )}
              </div>
              <h1 className="display mt-5 max-w-4xl text-[clamp(2.8rem,8vw,6.2rem)]">{trip.title}</h1>
              <p className={`num mt-4 text-[15px] ${cover ? 'text-[#fbf3e8]/85' : 'text-text-soft'}`}>
                {formatRange(trip.start_date, trip.end_date, t, locale)}
              </p>
            </Reveal>

            {/* Chiffres cles */}
            <Reveal delay={80}>
              <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-4">
                {cd.kind !== 'none' && (
                  <Stat
                    light={Boolean(cover)}
                    value={
                      cd.kind === 'before'
                        ? cd.days === 0
                          ? t('hub.countdown.today')
                          : cd.days === 1
                            ? t('hub.countdown.tomorrow')
                            : t('hub.countdown.before', { n: cd.days })
                        : cd.kind === 'during'
                          ? t('hub.countdown.during', { day: cd.day, total: cd.total })
                          : t('hub.countdown.after', { n: cd.days })
                    }
                    accent
                  />
                )}
                {totalDays && <Stat light={Boolean(cover)} value={t('hub.days', { n: totalDays })} />}
                {hub.stops.length > 0 && (
                  <Stat
                    light={Boolean(cover)}
                    value={hub.stops.length === 1 ? t('hub.stop') : t('hub.stops', { n: hub.stops.length })}
                  />
                )}
                {countries.length > 0 && (
                  <Stat light={Boolean(cover)} value={countries.join(' · ')} />
                )}
              </dl>
            </Reveal>

            <Reveal delay={140}>
              <div className="mt-9 flex flex-wrap items-center gap-2">
                <button onClick={() => setAssistant(true)} className="btn btn-accent">
                  <SparkIcon size={15} />
                  {t('ai.open')}
                </button>
                <button
                  onClick={exportCalendar}
                  className={`btn ${cover ? 'border-white/30 text-white hover:bg-white/10' : ''}`}
                  title={t('hub.calendarHint')}
                  disabled={hub.stops.length === 0 && hub.todos.length === 0}
                >
                  <CalendarIcon size={15} />
                  {t('hub.calendar')}
                </button>
                <button
                  onClick={() => setSharing((v) => !v)}
                  className={`btn ${cover ? 'border-white/30 text-white hover:bg-white/10' : ''}`}
                >
                  <ShareIcon size={15} />
                  {t('hub.share')}
                </button>
                <div className="ml-1 flex -space-x-2">
                  {hub.people.map((p) => (
                    <span key={p.user_id} className="rounded-full ring-2 ring-bg" title={p.display_name}>
                      <Avatar url={p.avatar_url} name={p.display_name} size={30} />
                    </span>
                  ))}
                </div>
                <button
                  onClick={() => setEditing((v) => !v)}
                  className={`btn btn-quiet btn-xs ml-auto ${cover ? 'text-white/80 hover:bg-white/10' : ''}`}
                >
                  {editing ? t('common.cancel') : t('hub.edit')}
                </button>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-6xl px-5 pb-28 sm:px-8">
        {hub.missingSchema && <p className="notice notice-bad mt-6">{t('error.missingTable')}</p>}

        {editing && (
          <div className="mt-8">
            <TripForm trip={trip} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />
          </div>
        )}
        {sharing && (
          <div className="mt-8">
            <SharePanel trip={trip} hub={hub} onLeft={() => navigate('/voyages')} />
          </div>
        )}

        {/* Onglets, colles en haut au defilement */}
        <div className="sticky top-16 z-[800] -mx-5 mt-8 px-5 py-3 sm:-mx-8 sm:px-8">
          <nav className="tabbar w-fit max-w-full">
            {TABS.map((x) => (
              <button key={x.id} onClick={() => go(x.id)} className={`tab ${tab === x.id ? 'tab-active' : ''}`}>
                {t(x.label)}
                {x.id === 'todo' && openTodos > 0 && <span className="tab-count num">{openTodos}</span>}
                {x.id === 'docs' && hub.docs.length > 0 && <span className="tab-count num">{hub.docs.length}</span>}
              </button>
            ))}
          </nav>
        </div>

        <div className="mt-6 fade-in" key={tab}>
          {tab === 'overview' && (
            <Overview
              trip={trip}
              hub={hub}
              go={go}
              onOpenAssistant={() => setAssistant(true)}
              onOpenShare={() => setSharing(true)}
            />
          )}
          {tab === 'route' && <RouteTab trip={trip} hub={hub} autoAdd={autoAdd} onOpenAssistant={() => setAssistant(true)} />}
          {tab === 'todo' && <TodoTab hub={hub} autoAdd={autoAdd} />}
          {tab === 'docs' && <DocsTab hub={hub} autoAdd={autoAdd} />}
          {tab === 'ideas' && <IdeasTab trip={trip} hub={hub} />}
          {tab === 'memories' && <Memories tripId={trip.id} planning={trip.status === 'planning'} />}
        </div>
      </div>

      {assistant && (
        <TripAssistant
          trip={trip}
          hub={hub}
          onClose={() => setAssistant(false)}
          onImported={() => {
            setAssistant(false)
            go('route')
          }}
        />
      )}
    </AppShell>
  )
}

function Stat({ value, light, accent = false }: { value: string; light: boolean; accent?: boolean }) {
  return (
    <div>
      <dd
        className={`display-sm num text-[1.35rem] ${
          accent ? (light ? 'text-[#f3b48c]' : 'text-accent') : light ? 'text-[#fbf3e8]' : ''
        }`}
      >
        {value}
      </dd>
    </div>
  )
}

/** Lieux, photos et parcours rattaches au voyage : le carnet de souvenirs. */
function Memories({ tripId, planning }: { tripId: string; planning: boolean }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { trips, places, tracks } = usePlaces()
  const [photos, setPhotos] = useState<Record<string, string[]>>({})
  const [zoom, setZoom] = useState<{ urls: string[]; index: number } | null>(null)
  const [choices, setChoices] = useState<string[] | null>(null)
  const trip = trips.find((x) => x.id === tripId)!

  const steps = useMemo(
    () =>
      places
        .filter((p) => p.trip_id === tripId)
        .sort((a, b) => (a.visit_date ?? '').localeCompare(b.visit_date ?? '')),
    [places, tripId],
  )
  const tripTracks = useMemo(() => tracks.filter((x) => x.trip_id === tripId), [tracks, tripId])
  const km = totalDistanceKm(steps)

  useEffect(() => {
    if (!user || steps.length === 0) return
    let active = true
    const ids = new Set(steps.map((s) => s.id))
    fetchAllPhotos(user.id)
      .then(async (all) => {
        const mine = all.filter((p) => ids.has(p.place_id))
        const signed = await signPhotoUrls(mine.map((p) => p.url))
        if (!active) return
        const byPlace: Record<string, string[]> = {}
        for (const photo of mine) {
          const url = signed[photo.url]
          if (!url) continue
          byPlace[photo.place_id] = [...(byPlace[photo.place_id] ?? []), url]
        }
        setPhotos(byPlace)
      })
      .catch(() => {
        // La frise reste lisible sans ses photos
      })
    return () => {
      active = false
    }
  }, [user, steps])

  return (
    <div className="space-y-12">
      {steps.length > 0 && (
        <div className="h-[380px] overflow-hidden rounded-[24px] border border-line">
          <MapCanvas
            points={steps.map((s) => ({ id: s.id, lat: s.lat, lng: s.lng, name: s.name, country: s.country }))}
            tracks={tripTracks.map((x) => ({ id: x.id, name: x.name, points: x.points }))}
            cluster={false}
            onSelect={(placeId) => navigate(`/carte?lieu=${placeId}`)}
            onAmbiguous={setChoices}
          />
        </div>
      )}

      {choices && (
        <PlaceChooser
          places={choices
            .map((placeId) => steps.find((p) => p.id === placeId))
            .filter((p): p is NonNullable<typeof p> => Boolean(p))}
          onPick={(place) => {
            setChoices(null)
            navigate(`/carte?lieu=${place.id}`)
          }}
          onClose={() => setChoices(null)}
        />
      )}

      {tripTracks.length > 0 && (
        <section>
          <p className="eyebrow mb-4">{t('trips.tracks')}</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tripTracks.map((track) => (
              <div key={track.id} className="card p-4">
                <p className="display-sm text-lg">{track.name}</p>
                <p className="num mt-1 text-[13px] text-text-muted">
                  {track.distance_km.toFixed(2).replace('.', ',')} km
                  {formatDuration(track.started_at, track.ended_at) &&
                    ` · ${formatDuration(track.started_at, track.ended_at)}`}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {planning && <TripPlanner trip={trip} />}

      <section className={planning ? 'hidden' : ''}>
        <p className="eyebrow">{t('trips.sequence')}</p>
        <h2 className="display mt-3 text-4xl">{t('trips.stepByStep')}</h2>
        {km > 0 && <p className="num mt-2 text-[13px] text-text-muted">{km} km</p>}

        {steps.length === 0 ? (
          <div className="card mt-8 px-8 py-12 text-center">
            <p className="lede">{t('trips.noSteps')}</p>
            <Link to="/carte" className="btn mt-6">{t('trips.goToMap')}</Link>
          </div>
        ) : (
          <ol className="relative mt-10 space-y-10 border-l border-line pl-6 sm:pl-8">
            {steps.map((step, i) => {
              const urls = photos[step.id] ?? []
              return (
                <Reveal as="li" key={step.id} delay={i * 50} className="relative">
                  <span className="absolute -left-[1.85rem] top-2 h-2.5 w-2.5 rounded-full bg-accent sm:-left-[2.35rem]" />
                  <p className="eyebrow num">{step.visit_date ? formatDate(step.visit_date) : t('trips.noStep')}</p>
                  <h3 className="display-sm mt-2 text-2xl">{step.name}</h3>
                  <p className="mt-1 text-[13px] text-text-muted">
                    {step.city ? `${step.city}, ` : ''}
                    {step.country}
                  </p>
                  {step.notes && (
                    <p className="mt-3 max-w-2xl whitespace-pre-wrap text-[14px] leading-relaxed text-text-soft">
                      {step.notes}
                    </p>
                  )}
                  {urls.length > 0 && (
                    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {urls.slice(0, 4).map((url, k) => (
                        <button
                          key={url}
                          onClick={() => setZoom({ urls, index: k })}
                          className="arch-soft aspect-[4/5] border border-line"
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
                </Reveal>
              )
            })}
          </ol>
        )}
      </section>

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
