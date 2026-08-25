import { useState } from 'react'
import { usePlaces } from '../context/PlacesContext'
import CoverPicker from './CoverPicker'
import type { Trip, TripStatus } from '../lib/types'
import { errorMessage } from '../lib/errors'

type Props = {
  trip?: Trip
  onDone: (trip: Trip) => void
  onCancel: () => void
}

/** Creation et modification d'un voyage, meme formulaire dans les deux cas. */
export default function TripForm({ trip, onDone, onCancel }: Props) {
  const { addTrip, editTrip } = usePlaces()
  const [title, setTitle] = useState(trip?.title ?? '')
  const [start, setStart] = useState(trip?.start_date ?? '')
  const [end, setEnd] = useState(trip?.end_date ?? '')
  const [cover, setCover] = useState(trip?.cover_url ?? '')
  const [notes, setNotes] = useState(trip?.notes ?? '')
  const [status, setStatus] = useState<TripStatus>(trip?.status ?? 'planning')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (start && end && end < start) {
      setError('La date de fin est avant la date de debut.')
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
        <label className="label">Ce voyage</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setStatus('planning')}
            className={`pill justify-center ${status === 'planning' ? 'pill-active' : ''}`}
          >
            A preparer
          </button>
          <button
            type="button"
            onClick={() => setStatus('done')}
            className={`pill justify-center ${status === 'done' ? 'pill-active' : ''}`}
          >
            Deja fait
          </button>
        </div>
      </div>

      <div>
        <label className="label">Titre du voyage</label>
        <input
          className="field"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Road trip en Autriche"
          required
          autoFocus
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Debut</label>
          <input
            className="field"
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Fin</label>
          <input
            className="field"
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="label">Photo de couverture</label>
        <CoverPicker value={cover} onChange={setCover} />
        <input
          className="field mt-2"
          value={cover}
          onChange={(e) => setCover(e.target.value)}
          placeholder="Ou collez l'adresse d'une image"
        />
      </div>

      <div>
        <label className="label">Notes</label>
        <textarea
          className="field min-h-20 resize-y"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Le fil du voyage, les personnes, les surprises..."
        />
      </div>

      {error && <p className="notice notice-bad">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" className="btn btn-accent" disabled={busy}>
          {busy ? 'Enregistrement...' : trip ? 'Enregistrer' : 'Creer le voyage'}
        </button>
        <button type="button" onClick={onCancel} className="btn btn-quiet">
          Annuler
        </button>
      </div>
    </form>
  )
}
