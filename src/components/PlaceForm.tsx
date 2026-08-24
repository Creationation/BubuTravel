import { useEffect, useRef, useState } from 'react'
import { searchPlaces } from '../lib/geocode'
import type { GeoResult } from '../lib/geocode'
import { usePlaces } from '../context/PlacesContext'
import type { Place } from '../lib/types'

export type Draft = {
  name: string
  country: string
  lat: number | null
  lng: number | null
  visit_date: string
  notes: string
}

export const emptyDraft: Draft = {
  name: '',
  country: '',
  lat: null,
  lng: null,
  visit_date: '',
  notes: '',
}

type Props = {
  draft: Draft
  onDraftChange: (next: Draft) => void
  /** Actif quand l'utilisateur est en train de choisir le point sur la carte. */
  picking: boolean
  onTogglePicking: () => void
  onSaved: (place: Place) => void
  onCancel: () => void
}

export default function PlaceForm({
  draft,
  onDraftChange,
  picking,
  onTogglePicking,
  onSaved,
  onCancel,
}: Props) {
  const { add } = usePlaces()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeoResult[]>([])
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Recherche d'adresse, debounce a 600 ms pour respecter la limite Nominatim
  useEffect(() => {
    const q = query.trim()
    if (q.length < 3) {
      setResults([])
      return
    }
    const timer = setTimeout(() => {
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setSearching(true)
      searchPlaces(q, ctrl.signal)
        .then(setResults)
        .catch((err) => {
          if (err instanceof Error && err.name !== 'AbortError') setError(err.message)
        })
        .finally(() => setSearching(false))
    }, 600)
    return () => clearTimeout(timer)
  }, [query])

  function pick(result: GeoResult) {
    onDraftChange({
      ...draft,
      name: draft.name || result.name,
      country: result.country || draft.country,
      lat: result.lat,
      lng: result.lng,
    })
    setResults([])
    setQuery(result.label)
  }

  const hasCoords = draft.lat !== null && draft.lng !== null

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!hasCoords) {
      setError("Choisissez un point : recherche d'adresse ou clic sur la carte.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const created = await add({
        name: draft.name.trim(),
        country: draft.country.trim(),
        lat: draft.lat!,
        lng: draft.lng!,
        visit_date: draft.visit_date || null,
        notes: draft.notes.trim() || null,
      })
      onSaved(created)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="flex max-h-[65vh] w-full shrink-0 flex-col border-t-2 border-ink bg-paper md:max-h-none md:w-[24rem] md:border-l-2 md:border-t-0">
      <header className="rule flex items-center justify-between bg-yellow px-5 py-4">
        <h2 className="font-display text-3xl leading-none">Nouveau lieu</h2>
        <button onClick={onCancel} className="btn btn-icon" aria-label="Fermer le formulaire">
          ✕
        </button>
      </header>

      <form onSubmit={onSubmit} className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
        <div className="relative">
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-widest">
            Rechercher une adresse
          </label>
          <input
            className="field"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Vienne, Autriche"
          />
          {searching && <p className="mt-1 text-[11px] text-muted">Recherche...</p>}
          {results.length > 0 && (
            <ul className="card-soft absolute z-20 mt-1 max-h-52 w-full overflow-y-auto p-1">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => pick(r)}
                    className="block w-full rounded-lg px-3 py-2 text-left text-xs leading-snug hover:bg-pink-soft"
                  >
                    {r.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card-soft p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest">Position</p>
              <p className="mt-1 font-mono text-[11px]">
                {hasCoords ? `${draft.lat!.toFixed(5)}, ${draft.lng!.toFixed(5)}` : 'non definie'}
              </p>
            </div>
            <button
              type="button"
              onClick={onTogglePicking}
              className={`btn btn-sm ${picking ? 'bg-teal text-white' : ''}`}
            >
              {picking ? 'Cliquez sur la carte' : 'Placer sur la carte'}
            </button>
          </div>
          {picking && (
            <p className="mt-3 text-[11px] leading-relaxed text-muted">
              Le nom et le pays se remplissent automatiquement, vous pouvez les corriger ensuite.
            </p>
          )}
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-widest">
            Nom du lieu
          </span>
          <input
            className="field"
            value={draft.name}
            onChange={(e) => onDraftChange({ ...draft, name: e.target.value })}
            placeholder="Schonbrunn"
            required
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-widest">Pays</span>
          <input
            className="field"
            value={draft.country}
            onChange={(e) => onDraftChange({ ...draft, country: e.target.value })}
            placeholder="Autriche"
            required
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-widest">
            Date de visite
          </span>
          <input
            className="field"
            type="date"
            value={draft.visit_date}
            onChange={(e) => onDraftChange({ ...draft, visit_date: e.target.value })}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-widest">Notes</span>
          <textarea
            className="field min-h-24 resize-y"
            value={draft.notes}
            onChange={(e) => onDraftChange({ ...draft, notes: e.target.value })}
            placeholder="Ce qu'on a vu, mange, retenu..."
          />
        </label>

        {error && <p className="tag-alert">{error}</p>}

        <div className="flex gap-2">
          <button type="submit" className="btn btn-primary flex-1" disabled={busy || !hasCoords}>
            {busy ? 'Enregistrement...' : 'Enregistrer le lieu'}
          </button>
          <button type="button" onClick={onCancel} className="btn">
            Annuler
          </button>
        </div>

        <p className="pb-2 text-[11px] leading-relaxed text-muted">
          Les photos s'ajoutent apres l'enregistrement, depuis le panneau du lieu.
        </p>
      </form>
    </aside>
  )
}
