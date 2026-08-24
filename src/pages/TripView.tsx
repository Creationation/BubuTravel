import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { usePlaces } from '../context/PlacesContext'
import { useAuth } from '../context/AuthContext'
import { fetchAllPhotos, signPhotoUrls } from '../lib/api'
import { formatDate, formatRange, totalDistanceKm } from '../lib/stats'
import { formatDuration } from '../lib/geolocation'
import AppShell from '../components/AppShell'
import MapCanvas from '../components/MapCanvas'
import Reveal from '../components/Reveal'
import TripForm from '../components/TripForm'
import TripPlanner from '../components/TripPlanner'
import Lightbox from '../components/Lightbox'

export default function TripView() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { trips, places, tracks, removeTrip, loading } = usePlaces()
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [photos, setPhotos] = useState<Record<string, string[]>>({})
  const [zoom, setZoom] = useState<{ urls: string[]; index: number } | null>(null)

  const trip = trips.find((t) => t.id === id)
  const steps = useMemo(
    () =>
      places
        .filter((p) => p.trip_id === id)
        .sort((a, b) => (a.visit_date ?? '').localeCompare(b.visit_date ?? '')),
    [places, id],
  )
  const tripTracks = useMemo(() => tracks.filter((t) => t.trip_id === id), [tracks, id])

  // Photos des etapes, groupees par lieu
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
        // La timeline reste lisible sans ses photos
      })
    return () => {
      active = false
    }
  }, [user, steps])

  if (loading) {
    return (
      <AppShell>
        <p className="mx-auto max-w-6xl px-5 py-16 text-[13px] text-text-muted">Chargement...</p>
      </AppShell>
    )
  }

  if (!trip) {
    return (
      <AppShell>
        <div className="mx-auto max-w-6xl px-5 py-20 text-center sm:px-8">
          <h1 className="display-sm text-3xl">Voyage introuvable</h1>
          <p className="lede mt-3">Il a peut-etre ete supprime.</p>
          <Link to="/voyages" className="btn mt-6">
            Retour aux voyages
          </Link>
        </div>
      </AppShell>
    )
  }

  const km = totalDistanceKm(steps)
  const countries = [...new Set(steps.map((s) => s.country))]

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-6xl px-5 pb-24 sm:px-8">
        {/* En-tete */}
        <section className="border-b border-line py-10 sm:py-14">
          <Reveal>
            <Link to="/voyages" className="text-[13px] text-text-muted hover:text-text">
              ← Voyages
            </Link>
            <div className="mt-5 flex flex-wrap items-end justify-between gap-5">
              <div>
                <p className="eyebrow">
                  {trip.status === 'planning' ? 'En preparation · ' : ''}
                  {formatRange(trip.start_date, trip.end_date)}
                </p>
                <h1 className="display mt-3 text-[clamp(2.2rem,6vw,4.2rem)]">{trip.title}</h1>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditing((v) => !v)} className="btn btn-xs">
                  {editing ? 'Annuler' : 'Modifier'}
                </button>
                <button
                  onClick={async () => {
                    if (!confirmDelete) {
                      setConfirmDelete(true)
                      return
                    }
                    await removeTrip(trip.id)
                    navigate('/voyages')
                  }}
                  className={`btn btn-xs ${confirmDelete ? 'border-red-500/60 text-red-400' : 'btn-quiet'}`}
                >
                  {confirmDelete ? 'Confirmer la suppression' : 'Supprimer'}
                </button>
              </div>
            </div>
            {trip.notes && <p className="lede mt-5 max-w-2xl">{trip.notes}</p>}
            <p className="mt-5 text-[13px] text-text-muted">
              {steps.length} etape{steps.length > 1 ? 's' : ''}
              {countries.length > 0 && ` · ${countries.join(', ')}`}
              {km > 0 && ` · ${km} km a vol d'oiseau`}
            </p>
          </Reveal>
        </section>

        {editing && (
          <div className="mt-8">
            <TripForm trip={trip} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />
          </div>
        )}

        {/* Carte du voyage */}
        {steps.length > 0 && (
          <Reveal className="mt-10">
            <div className="h-[420px] overflow-hidden rounded-2xl border border-line">
              <MapCanvas
                points={steps.map((s) => ({
                  id: s.id,
                  lat: s.lat,
                  lng: s.lng,
                  name: s.name,
                  country: s.country,
                }))}
                tracks={tripTracks.map((t) => ({ id: t.id, name: t.name, points: t.points }))}
                cluster={false}
                onSelect={(placeId) => navigate(`/carte?lieu=${placeId}`)}
              />
            </div>
          </Reveal>
        )}

        {/* Parcours enregistres */}
        {tripTracks.length > 0 && (
          <section className="mt-12">
            <Reveal className="mb-4">
              <p className="eyebrow">Parcours</p>
            </Reveal>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {tripTracks.map((track, i) => (
                <Reveal key={track.id} delay={i * 50}>
                  <div className="panel p-4">
                    <p className="display-sm text-lg">{track.name}</p>
                    <p className="mt-1 text-[13px] text-text-muted">
                      {track.distance_km.toFixed(2).replace('.', ',')} km
                      {formatDuration(track.started_at, track.ended_at) &&
                        ` · ${formatDuration(track.started_at, track.ended_at)}`}
                    </p>
                  </div>
                </Reveal>
              ))}
            </div>
          </section>
        )}

        {trip.status === 'planning' && (
          <div className="mt-12">
            <TripPlanner trip={trip} />
          </div>
        )}

        {/* Timeline des etapes */}
        <section className={`mt-14 ${trip.status === 'planning' ? 'hidden' : ''}`}>
          <Reveal className="mb-8">
            <p className="eyebrow">Deroule</p>
            <h2 className="display-sm mt-2 text-3xl">Etape par etape</h2>
          </Reveal>

          {steps.length === 0 ? (
            <div className="panel px-8 py-12 text-center">
              <p className="lede">
                Aucune etape rattachee. Ouvrez un lieu sur la carte et choisissez ce voyage dans son
                panneau.
              </p>
              <Link to="/carte" className="btn mt-6">
                Aller a la carte
              </Link>
            </div>
          ) : (
            <ol className="relative space-y-8 border-l border-line pl-6 sm:pl-8">
              {steps.map((step, i) => {
                const urls = photos[step.id] ?? []
                return (
                  <Reveal as="li" key={step.id} delay={i * 60} className="relative">
                    <span className="absolute -left-[1.85rem] top-2 h-2.5 w-2.5 rounded-full bg-accent sm:-left-[2.35rem]" />
                    <p className="eyebrow">
                      {step.visit_date ? formatDate(step.visit_date) : 'Sans date'}
                    </p>
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
      </div>

      {zoom && (
        <Lightbox
          urls={zoom.urls}
          index={zoom.index}
          onIndexChange={(index) => setZoom({ ...zoom, index })}
          onClose={() => setZoom(null)}
        />
      )}
    </AppShell>
  )
}
