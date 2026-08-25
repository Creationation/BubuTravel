import { useState } from 'react'
import { usePlaces } from '../context/PlacesContext'
import { updateTrack } from '../lib/api'
import { formatDuration } from '../lib/geolocation'
import type { Track } from '../lib/types'
import { errorMessage } from '../lib/errors'
import { useI18n } from '../i18n/I18nContext'

export default function TrackSidebar({ track, onClose }: { track: Track; onClose: () => void }) {
  const { t, locale } = useI18n()
  const { trips, removeTrack } = usePlaces()
  const [name, setName] = useState(track.name)
  const [tripId, setTripId] = useState(track.trip_id ?? '')
  const [notes, setNotes] = useState(track.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const started = track.started_at ? new Date(track.started_at) : null

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await updateTrack(track.id, {
        name: name.trim() || t('track.unnamed'),
        trip_id: tripId || null,
        notes: notes.trim() || null,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function onDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setBusy(true)
    try {
      await removeTrack(track.id)
      onClose()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <aside className="panel-enter flex max-h-[58vh] w-full shrink-0 flex-col border-t border-line bg-bg md:max-h-none md:w-[25rem] md:border-l md:border-t-0">
      <header className="border-b border-line px-6 pb-5 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">{t('trips.tracks')}</p>
            <h2 className="display-sm mt-2 truncate text-3xl">{track.name}</h2>
          </div>
          <button onClick={onClose} className="btn btn-icon btn-quiet" aria-label={t('common.close')}>
            ✕
          </button>
        </div>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line">
          <Cell label={t('track.distance')} value={`${track.distance_km.toFixed(2).replace('.', ',')} km`} />
          <Cell
            label={t('track.duration')}
            value={formatDuration(track.started_at, track.ended_at) || t('track.short')}
          />
          <Cell label={t('track.pointsLabel')} value={String(track.points.length)} />
        </div>

        {started && (
          <p className="text-[13px] text-text-muted">
            Enregistre le{' '}
            {started.toLocaleDateString(locale, {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}{' '}
            a {started.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}

        <div>
          <label className="label">{t('common.name')}</label>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div>
          <label className="label">{t('common.trip')}</label>
          <select className="field" value={tripId} onChange={(e) => setTripId(e.target.value)}>
            <option value="">{t('track.noTrip')}</option>
            {trips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">{t('common.notes')}</label>
          <textarea
            className="field min-h-20 resize-y"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('track.notesPlaceholder')}
          />
        </div>

        {error && <p className="notice notice-bad">{error}</p>}
        {saved && <p className="notice">{t('track.saved')}</p>}

        <button onClick={() => void save()} className="btn btn-accent w-full" disabled={busy}>
          {busy ? t('common.saving') : t('common.save')}
        </button>
      </div>

      <footer className="border-t border-line px-6 py-4">
        <button
          onClick={() => void onDelete()}
          disabled={busy}
          className={`btn btn-xs w-full ${confirmDelete ? 'border-red-500/60 text-red-400' : 'btn-quiet'}`}
        >
          {confirmDelete ? t('track.deleteConfirm') : t('track.deleteAction')}
        </button>
      </footer>
    </aside>
  )
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg px-3 py-3 text-center">
      <p className="display-sm text-lg">{value}</p>
      <p className="eyebrow mt-1 text-[10px]">{label}</p>
    </div>
  )
}
