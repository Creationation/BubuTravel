import { useEffect, useState } from 'react'
import { addCompanion, fetchCompanions } from '../lib/companions'
import type { Companion } from '../lib/companions'
import { Avatar } from './AppShell'
import { usePlaces } from '../context/PlacesContext'
import CoverPicker from './CoverPicker'
import type { Trip, TripStatus } from '../lib/types'
import { errorMessage } from '../lib/errors'
import { useT } from '../i18n/I18nContext'

type Props = {
  trip?: Trip
  onDone: (trip: Trip) => void
  onCancel: () => void
}

/** Creation et modification d'un voyage, meme formulaire dans les deux cas. */
export default function TripForm({ trip, onDone, onCancel }: Props) {
  const t = useT()
  const { addTrip, editTrip } = usePlaces()
  const [title, setTitle] = useState(trip?.title ?? '')
  const [start, setStart] = useState(trip?.start_date ?? '')
  const [end, setEnd] = useState(trip?.end_date ?? '')
  const [cover, setCover] = useState(trip?.cover_url ?? '')
  const [notes, setNotes] = useState(trip?.notes ?? '')
  const [status, setStatus] = useState<TripStatus>(trip?.status ?? 'planning')
  const [busy, setBusy] = useState(false)
  // Creation : les compagnons de voyage habituels, a cocher en un tap
  const [companions, setCompanions] = useState<Companion[]>([])
  const [withIds, setWithIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (trip) return
    void fetchCompanions()
      .then((list) => {
        setCompanions(list)
        setWithIds(new Set(list.map((c) => c.user_id)))
      })
      .catch(() => undefined)
  }, [trip])
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (start && end && end < start) {
      setError(t('trips.endBeforeStart'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const payload = {
        title: title.trim(),
        start_date: start || null,
        end_date: end || null,
        cover_url: cover.trim() || null,
        notes: notes.trim() || null,
        status,
        checklist: trip?.checklist ?? [],
      }
      const result = trip ? await editTrip(trip.id, payload) : await addTrip(payload)
      if (!trip) {
        for (const id of withIds) await addCompanion(result.id, id).catch(() => undefined)
      }
      onDone(result)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="panel space-y-4 p-6">
      <div>
        <label className="label">{t('trips.thisTrip')}</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setStatus('planning')}
            className={`pill justify-center ${status === 'planning' ? 'pill-active' : ''}`}
          >{t('trips.statusPlanning')}</button>
          <button
            type="button"
            onClick={() => setStatus('done')}
            className={`pill justify-center ${status === 'done' ? 'pill-active' : ''}`}
          >{t('trips.statusDone')}</button>
        </div>
      </div>

      <div>
        <label className="label">{t('trips.titleLabel')}</label>
        <input
          className="field"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('ph.trip')}
          required
          autoFocus
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">{t('trips.start')}</label>
          <input
            className="field"
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div>
          <label className="label">{t('trips.end')}</label>
          <input
            className="field"
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="label">{t('trips.cover')}</label>
        <CoverPicker value={cover} onChange={setCover} />
        <input
          className="field mt-2"
          value={cover}
          onChange={(e) => setCover(e.target.value)}
          placeholder={t('trips.coverPaste')}
        />
      </div>

      <div>
        <label className="label">{t('common.notes')}</label>
        <textarea
          className="field min-h-20 resize-y"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t('trips.notesPlaceholder')}
        />
      </div>

      {!trip && companions.length > 0 && (
        <div>
          <label className="label">{t('sh.travelWith')}</label>
          <div className="flex flex-wrap gap-2">
            {companions.map((c) => {
              const on = withIds.has(c.user_id)
              return (
                <button
                  type="button"
                  key={c.user_id}
                  onClick={() =>
                    setWithIds((prev) => {
                      const next = new Set(prev)
                      if (on) next.delete(c.user_id)
                      else next.add(c.user_id)
                      return next
                    })
                  }
                  className={`flex items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-4 ${on ? 'border-accent bg-[var(--halo)]' : 'border-line bg-surface'}`}
                >
                  <Avatar url={c.avatar_url} name={c.display_name} size={28} />
                  <span className="text-[14px] font-bold">{on ? '✓ ' : ''}{c.display_name}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {error && <p className="notice notice-bad">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" className="btn btn-accent" disabled={busy}>
          {busy ? t('common.saving') : trip ? t('common.save') : t('trips.createAction')}
        </button>
        <button type="button" onClick={onCancel} className="btn btn-quiet">{t('common.cancel')}</button>
      </div>
    </form>
  )
}
