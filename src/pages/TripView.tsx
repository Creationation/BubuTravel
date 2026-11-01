import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { usePlaces } from '../context/PlacesContext'
import { useAuth } from '../context/AuthContext'
import { fetchAllPhotos, signPhotoUrls } from '../lib/api'
import { formatDate, totalDistanceKm } from '../lib/stats'
import { formatDuration } from '../lib/geolocation'
import { daysBetween } from '../lib/tripDates'
import { buildTripIcs, downloadIcs } from '../lib/ics'
import { useTripHub } from '../lib/useTripHub'
import AppShell from '../components/AppShell'
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
import CountriesTab from '../components/hub/CountriesTab'
import DayPlanTab from '../components/hub/DayPlanTab'
import AssistantChat from '../components/hub/AssistantChat'
import { MODES, modeKey } from '../components/hub/StopForm'
import { useI18n } from '../i18n/I18nContext'
import TripHero from '../components/hub/TripHero'
import type { Key } from '../i18n/fr'
import type { TransportMode } from '../lib/types'
import { fmtNum } from '../i18n/current'
import { countryName } from '../lib/countryName'

const TABS: { id: HubTab; label: Key }[] = [
  { id: 'overview', label: 'hub.tab.overview' },
  { id: 'day', label: 'hub.tab.day' },
  { id: 'route', label: 'hub.tab.route' },
  { id: 'todo', label: 'hub.tab.todo' },
  { id: 'docs', label: 'hub.tab.docs' },
  { id: 'countries', label: 'hub.tab.countries' },
  { id: 'ideas', label: 'hub.tab.ideas' },
  { id: 'assistant', label: 'hub.tab.assistant' },
  { id: 'memories', label: 'hub.tab.memories' },
]

/**
 * Le carnet de route d'un voyage : en-tete avec compte a rebours, puis des
 * onglets pour l'itineraire, les choses a faire, les documents, les idees
 * venues des reseaux et les souvenirs (lieux, photos, parcours).
 */
export default function TripView() {
  const { t } = useI18n()
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { trips, places: allPlaces, loading } = usePlaces()
  const tripPlaces = useMemo(() => allPlaces.filter((p) => p.trip_id === id), [allPlaces, id])
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

  const totalDays = trip.start_date && trip.end_date ? daysBetween(trip.start_date, trip.end_date) + 1 : null
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
      <TripHero
        trip={trip}
        hub={hub}
        cover={cover}
        places={tripPlaces}
        totalDays={totalDays}
        editing={editing}
        onAssistant={() => setAssistant(true)}
        onCalendar={exportCalendar}
        onShare={() => setSharing((v) => !v)}
        onEdit={() => setEditing((v) => !v)}
      />

      <div className="mx-auto w-full max-w-6xl px-5 pb-28 sm:px-8">
        {hub.missingSchema && <p className="notice notice-bad mt-6">{t('error.missingTable')}</p>}

        {editing && (
          <div className="mt-8">
            <TripForm trip={trip} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />
          </div>
        )}
        {sharing && (
          <SharePanel trip={trip} hub={hub} onLeft={() => navigate('/voyages')} onClose={() => setSharing(false)} />
        )}

        {/* Onglets, colles en haut au defilement */}
        <div className="-mx-5 mt-8 px-5 py-3 sm:sticky sm:top-16 sm:z-[800] sm:-mx-8 sm:px-8">
          <nav className="tabbar w-fit max-w-full">
            {TABS.map((x) => (
              <button
                key={x.id}
                onClick={() => go(x.id)}
                ref={(el) => {
                  // L onglet actif se place au centre de la barre
                  // (defilement horizontal seulement : la page ne doit pas sauter)
                  const bar = el?.parentElement
                  if (el && bar && tab === x.id)
                    bar.scrollTo({ left: el.offsetLeft - bar.clientWidth / 2 + el.clientWidth / 2, behavior: 'smooth' })
                }}
                className={`tab ${tab === x.id ? 'tab-active' : ''}`}
              >
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
          {tab === 'day' && <DayPlanTab trip={trip} hub={hub} />}
          {tab === 'assistant' && <AssistantChat trip={trip} hub={hub} />}
          {tab === 'route' && <RouteTab trip={trip} hub={hub} autoAdd={autoAdd} onOpenAssistant={() => setAssistant(true)} />}
          {tab === 'todo' && <TodoTab hub={hub} autoAdd={autoAdd} />}
          {tab === 'docs' && <DocsTab hub={hub} autoAdd={autoAdd} />}
          {tab === 'countries' && <CountriesTab trip={trip} hub={hub} />}
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
                  {fmtNum(track.distance_km, 2)} km
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
                    {countryName(step.country)}
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
