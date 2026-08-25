import { useEffect, useState } from 'react'
import { useTracker } from '../context/TrackerContext'
import { usePlaces } from '../context/PlacesContext'
import { useAuth } from '../context/AuthContext'
import { createTrack } from '../lib/api'
import { formatDuration } from '../lib/geolocation'
import type { Track } from '../lib/types'
import { useT } from '../i18n/I18nContext'
import { errorMessage } from '../lib/errors'

type Props = {
  onSaved: (track: Track) => void
}

/**
 * Panneau flottant d'enregistrement de parcours. Reste visible pendant toute
 * la randonnee, avec distance et duree en direct, et propose de nommer la
 * trace au moment de l'arret.
 */
export default function TrackRecorder({ onSaved }: Props) {
  const t = useT()
  const { recording, distanceKm, error, start, pause, resume, discard, finish } = useTracker()
  const { trips } = usePlaces()
  const { user } = useAuth()
  const [finishing, setFinishing] = useState<{
    points: { t: number; lat: number; lng: number }[]
    startedAt: string
    endedAt: string
    distanceKm: number
  } | null>(null)
  const [name, setName] = useState('')
  const [tripId, setTripId] = useState('')
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date().toISOString())

  // Horloge pour la duree affichee, une fois toutes les 10 s suffit
  useEffect(() => {
    if (!recording) return
    const id = setInterval(() => setNow(new Date().toISOString()), 10000)
    return () => clearInterval(id)
  }, [recording])

  async function save() {
    if (!finishing || !user) return
    setBusy(true)
    setSaveError(null)
    try {
      const track = await createTrack({
        user_id: user.id,
        trip_id: tripId || null,
        name: name.trim() || t('track.unnamed'),
        points: finishing.points,
        distance_km: Number(finishing.distanceKm.toFixed(3)),
        started_at: finishing.startedAt,
        ended_at: finishing.endedAt,
        notes: null,
      })
      setFinishing(null)
      setName('')
      setTripId('')
      onSaved(track)
    } catch (err) {
      setSaveError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  // Formulaire de fin de parcours
  if (finishing) {
    return (
      <div className="panel fade-in w-72 p-4 shadow-xl">
        <p className="eyebrow">{t('track.done')}</p>
        <p className="display-sm mt-2 text-2xl">
          {finishing.distanceKm.toFixed(2).replace('.', ',')} km
        </p>
        <p className="mt-1 text-[12px] text-text-muted">
          {finishing.points.length} points ·{' '}
          {formatDuration(finishing.startedAt, finishing.endedAt) || 'moins d une minute'}
        </p>

        <input
          className="field mt-3"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('track.nameLabel')}
          autoFocus
        />
        {trips.length > 0 && (
          <select
            className="field mt-2"
            value={tripId}
            onChange={(e) => setTripId(e.target.value)}
          >
            <option value="">{t('track.noTrip')}</option>
            {trips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        )}

        {saveError && <p className="notice notice-bad mt-2">{saveError}</p>}

        <div className="mt-3 flex gap-2">
          <button onClick={() => void save()} className="btn btn-accent btn-xs flex-1" disabled={busy}>
            {busy ? t('common.saving') : t('common.save')}
          </button>
          <button onClick={() => setFinishing(null)} className="btn btn-quiet btn-xs">{t('track.throwAway')}</button>
        </div>
      </div>
    )
  }

  // Enregistrement en cours
  if (recording) {
    return (
      <div className="panel fade-in w-64 p-4 shadow-xl">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${recording.paused ? 'bg-text-muted' : 'animate-pulse bg-accent'}`}
          />
          <p className="eyebrow mb-0">
            {recording.paused ? t('track.paused') : t('track.recording')}
          </p>
        </div>

        <p className="display-sm mt-2 text-3xl">
          {distanceKm.toFixed(2).replace('.', ',')} km
        </p>
        <p className="mt-1 text-[12px] text-text-muted">
          {recording.points.length} points ·{' '}
          {formatDuration(recording.startedAt, now) || 'moins d une minute'}
        </p>

        {error && <p className="notice notice-bad mt-2">{t(error)}</p>}
        {recording.points.length === 0 && !error && (
          <p className="notice mt-2">{t('track.waitingFix')}</p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => (recording.paused ? resume() : pause())}
            className="btn btn-xs flex-1"
          >
            {recording.paused ? t('track.resume') : t('track.pause')}
          </button>
          <button
            onClick={() => {
              const result = finish()
              if (result) setFinishing(result)
            }}
            className="btn btn-accent btn-xs flex-1"
            disabled={recording.points.length < 2}
            title={recording.points.length < 2 ? t('track.needTwoPoints') : undefined}
          >{t('track.finish')}</button>
          <button onClick={discard} className="btn btn-quiet btn-xs w-full">{t('track.discard')}</button>
        </div>
      </div>
    )
  }

  return (
    <button onClick={start} className="btn shadow-lg" title={t('track.recordHint')}>
      <span className="h-1.5 w-1.5 rounded-full bg-accent" />{t('track.record')}</button>
  )
}
