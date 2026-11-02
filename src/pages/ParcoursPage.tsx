import { useMemo, useState } from 'react'
import AppShell from '../components/AppShell'
import MapCanvas from '../components/MapCanvas'
import TrackRecorder from '../components/TrackRecorder'
import { usePlaces } from '../context/PlacesContext'
import { useTracker } from '../context/TrackerContext'
import { formatDuration } from '../lib/geolocation'
import { errorMessage } from '../lib/errors'
import { fmtNum } from '../i18n/current'
import { useI18n } from '../i18n/I18nContext'

/**
 * Les parcours, a part du reste : on enregistre un trajet de A a B (a pied,
 * en scooter, en bus...), la trace se dessine en direct, puis elle est rangee
 * dans la liste avec sa distance et sa duree. Rien ici n'est melange avec
 * les lieux a visiter.
 */
export default function ParcoursPage() {
  const { t, locale } = useI18n()
  const { tracks, pushTrack, removeTrack, trips } = usePlaces()
  const { recording } = useTracker()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sorted = useMemo(
    () => [...tracks].sort((a, b) => (b.started_at ?? b.created_at).localeCompare(a.started_at ?? a.created_at)),
    [tracks],
  )
  const selected = sorted.find((x) => x.id === selectedId) ?? null
  const totalKm = sorted.reduce((n, x) => n + (x.distance_km || 0), 0)

  const lines = (selected ? [selected] : sorted.slice(0, 30))
    .filter((x) => x.points.length > 1)
    .map((x) => ({ id: x.id, name: x.name, points: x.points }))
  const fit = (selected?.points ?? (recording?.points.length ? recording.points : sorted[0]?.points) ?? []).map((p) => ({ lat: p.lat, lng: p.lng }))

  async function remove(id: string) {
    if (confirmId !== id) {
      setConfirmId(id)
      return
    }
    try {
      await removeTrack(id)
      setConfirmId(null)
      if (selectedId === id) setSelectedId(null)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-5xl px-5 pb-28 sm:px-8">
        <div className="py-8 sm:py-12">
          <p className="eyebrow eyebrow-dot">{t('route.eyebrow')}</p>
          <h1 className="display mt-3 text-[clamp(2.2rem,7vw,4.2rem)]">{t('route.title')}</h1>
          <p className="lede mt-3 max-w-2xl">{t('route.intro')}</p>
        </div>

        {error && <p className="notice notice-bad mb-4">{error}</p>}

        <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
          {/* Carte du parcours : trace en direct ou parcours choisi */}
          <div className="relative h-[22rem] overflow-hidden rounded-[26px] border border-line shadow-[var(--shadow-md)] sm:h-[28rem]">
            <MapCanvas
              key={selectedId ?? (recording ? 'live' : 'all')}
              points={[]}
              tracks={lines}
              liveTrack={recording?.points ?? null}
              autoFit={fit.length > 0}
              fitTo={fit}
              cluster={false}
              onTrackSelect={(id) => setSelectedId(id)}
            />
            <div className="absolute bottom-4 left-4 z-[1000]">
              <TrackRecorder onSaved={(track) => { pushTrack(track); setSelectedId(track.id) }} />
            </div>
          </div>

          <section>
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-[1.25rem] font-extrabold">
                {t('route.history')} <span className="num text-[1rem] text-text-muted">{sorted.length}</span>
              </h2>
              {sorted.length > 0 && <span className="num text-[13px] font-semibold text-text-muted">{fmtNum(totalKm, 1)} km</span>}
            </div>
            {sorted.length === 0 ? (
              <p className="rounded-[22px] border border-dashed border-line-strong p-5 text-[14px] leading-relaxed text-text-muted">{t('route.empty')}</p>
            ) : (
              <ul className="space-y-2.5">
                {sorted.map((x) => {
                  const active = x.id === selectedId
                  const trip = trips.find((tr) => tr.id === x.trip_id)
                  return (
                    <li key={x.id} className={`rounded-[20px] border bg-surface p-3.5 transition-colors ${active ? 'border-accent bg-[var(--halo)]' : 'border-line'}`}>
                      <button onClick={() => setSelectedId(active ? null : x.id)} className="block w-full text-left">
                        <span className="block truncate text-[15px] font-extrabold">{x.name}</span>
                        <span className="num mt-0.5 block text-[12px] text-text-muted">
                          {x.started_at ? new Date(x.started_at).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                          {trip ? ` · ${trip.title}` : ''}
                        </span>
                        <span className="mt-2 flex gap-2">
                          <span className="chip num">{fmtNum(x.distance_km, 2)} km</span>
                          <span className="chip num">{formatDuration(x.started_at, x.ended_at) || t('track.shortDuration')}</span>
                          <span className="chip num">{x.points.length} {t('track.pointsLabel').toLowerCase()}</span>
                        </span>
                      </button>
                      <div className="mt-2.5 flex justify-end">
                        <button onClick={() => void remove(x.id)} className={`btn btn-xs ${confirmId === x.id ? 'btn-accent' : 'btn-quiet'}`}>
                          {confirmId === x.id ? t('track.deleteConfirm') : t('track.deleteAction')}
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  )
}
