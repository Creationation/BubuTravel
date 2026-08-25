import { useEffect, useRef, useState } from 'react'
import { searchPlaces } from '../lib/geocode'
import type { GeoResult } from '../lib/geocode'
import { usePlaces } from '../context/PlacesContext'
import { useAuth } from '../context/AuthContext'
import { readPhotoMeta } from '../lib/exif'
import { reverseGeocode } from '../lib/geocode'
import { uploadPhoto } from '../lib/api'
import type { Place, PlaceStatus } from '../lib/types'
import { CURRENCIES, PRICE_LEVELS, Stars } from './PlaceExtras'
import { errorMessage } from '../lib/errors'

export type Draft = {
  name: string
  country: string
  city: string
  lat: number | null
  lng: number | null
  visit_date: string
  notes: string
  trip_id: string
  category_id: string
  status: PlaceStatus
  cost: string
  currency: string
  price_level: number | null
  rating: number | null
  review: string
  promo_note: string
  promo_code: string
  promo_until: string
}

export const emptyDraft: Draft = {
  name: '',
  country: '',
  city: '',
  lat: null,
  lng: null,
  visit_date: '',
  notes: '',
  trip_id: '',
  category_id: '',
  status: 'visited',
  cost: '',
  currency: 'EUR',
  price_level: null,
  rating: null,
  review: '',
  promo_note: '',
  promo_code: '',
  promo_until: '',
}

export type GpsInfo = {
  /** Precision annoncee par le navigateur, en metres. */
  accuracy: number
  /** Adresse proposee par le geocodage inverse. */
  label: string
}

type Props = {
  draft: Draft
  onDraftChange: (next: Draft) => void
  picking: boolean
  onTogglePicking: () => void
  onSaved: (place: Place) => void
  onCancel: () => void
  /** Renseigne quand le lieu vient du bouton « Je suis ici ». */
  gps?: GpsInfo | null
}

export default function PlaceForm({
  draft,
  onDraftChange,
  picking,
  onTogglePicking,
  onSaved,
  onCancel,
  gps = null,
}: Props) {
  const { add, trips, categories, addCategory, bumpPhotoCount } = usePlaces()
  const { user } = useAuth()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeoResult[]>([])
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<File[]>([])
  const [exifNote, setExifNote] = useState<string | null>(null)
  const [gpsConfirmed, setGpsConfirmed] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const touchedRef = useRef(false)
  const searchRef = useRef<HTMLInputElement | null>(null)

  // Autocompletion d'adresse, debounce a 550 ms pour tenir la limite Nominatim
  useEffect(() => {
    const q = query.trim()
    if (!touchedRef.current || q.length < 3) {
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
    }, 550)
    return () => clearTimeout(timer)
  }, [query])

  function pick(result: GeoResult) {
    touchedRef.current = false
    onDraftChange({
      ...draft,
      name: draft.name || result.name,
      country: result.country || draft.country,
      city: result.city || draft.city,
      lat: result.lat,
      lng: result.lng,
    })
    setResults([])
    setQuery(result.label)
  }

  /**
   * Les photos choisies avant l'enregistrement servent aussi a pre-remplir le
   * formulaire : date de prise de vue et position GPS lues dans l'EXIF. Elles
   * sont mises de cote et envoyees une fois le lieu cree, puisque le chemin de
   * stockage contient l'identifiant du lieu.
   */
  async function onPickFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const list = Array.from(files)
    setPending((prev) => [...prev, ...list])
    setError(null)
    setExifNote(null)

    const meta = await readPhotoMeta(list[0])
    const bits: string[] = []
    let next = { ...draft }

    if (meta.takenAt && !draft.visit_date) {
      next = { ...next, visit_date: meta.takenAt }
      bits.push('date de prise de vue')
    }
    if (meta.lat !== null && meta.lng !== null && draft.lat === null) {
      next = { ...next, lat: meta.lat, lng: meta.lng }
      bits.push('position GPS')
      const found = await reverseGeocode(meta.lat, meta.lng)
      if (found) {
        next = {
          ...next,
          name: next.name || found.name,
          country: next.country || found.country,
          city: next.city || found.city,
        }
        bits.push('nom et pays')
      }
    }

    onDraftChange(next)
    setExifNote(
      bits.length > 0
        ? `Rempli depuis la photo : ${bits.join(', ')}.`
        : "La photo ne contient ni date ni position exploitables, a saisir a la main.",
    )
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
      setStep('Enregistrement du lieu')
      const created = await add({
        name: draft.name.trim(),
        country: draft.country.trim(),
        city: draft.city.trim() || null,
        lat: draft.lat!,
        lng: draft.lng!,
        visit_date: draft.visit_date || null,
        notes: draft.notes.trim() || null,
        trip_id: draft.trip_id || null,
        category_id: draft.category_id || null,
        status: draft.status,
        planned_order: null,
        // Une virgule decimale saisie a la main doit etre acceptee
        cost: draft.cost.trim() ? Number(draft.cost.replace(',', '.')) : null,
        currency: draft.currency,
        price_level: draft.price_level,
        rating: draft.rating,
        review: draft.review.trim() || null,
        promo_note: draft.promo_note.trim() || null,
        promo_code: draft.promo_code.trim() || null,
        promo_until: draft.promo_until || null,
      })

      if (pending.length > 0 && user) {
        for (let i = 0; i < pending.length; i++) {
          setStep(`Envoi des photos ${i + 1} / ${pending.length}`)
          await uploadPhoto(user.id, created.id, pending[i])
        }
        bumpPhotoCount(pending.length)
      }
      onSaved(created)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
      setStep(null)
    }
  }

  return (
    <aside className="panel-enter flex max-h-[68vh] w-full shrink-0 flex-col border-t border-line bg-bg md:max-h-none md:w-[25rem] md:border-l md:border-t-0">
      <header className="flex items-center justify-between border-b border-line px-6 pb-5 pt-6">
        <div>
          <p className="eyebrow">
            {gps ? 'Releve sur place' : draft.status === 'wishlist' ? 'Bucketlist' : 'Nouvelle etape'}
          </p>
          <h2 className="display-sm mt-2 text-3xl">
            {gps ? 'Je suis ici' : draft.status === 'wishlist' ? 'Ajouter une envie' : 'Ajouter un lieu'}
          </h2>
        </div>
        <button onClick={onCancel} className="btn btn-icon btn-quiet" aria-label="Fermer">
          ✕
        </button>
      </header>

      <form onSubmit={onSubmit} className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
        {/* Deja vu, ou envie a garder sous le coude */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onDraftChange({ ...draft, status: 'visited' })}
            className={`pill justify-center ${draft.status === 'visited' ? 'pill-active' : ''}`}
          >
            Deja visite
          </button>
          <button
            type="button"
            onClick={() => onDraftChange({ ...draft, status: 'wishlist' })}
            className={`pill justify-center ${draft.status === 'wishlist' ? 'pill-active' : ''}`}
          >
            A visiter
          </button>
        </div>

        {/* Verification de l'adresse : le GPS se trompe souvent en ville */}
        {gps && !gpsConfirmed && (
          <div className="rounded-xl border border-line bg-surface-2 p-4">
            <p className="label mb-1">Est-ce la bonne adresse ?</p>
            <p className="text-[13px] leading-relaxed text-text-soft">{gps.label}</p>
            <p className="mt-2 text-[11px] text-text-muted">
              Position relevee a environ {Math.round(gps.accuracy)} m pres. En ville, entre deux
              batiments, le releve peut tomber a cote.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn btn-accent btn-xs" onClick={() => setGpsConfirmed(true)}>
                Oui, c'est ici
              </button>
              <button
                type="button"
                className="btn btn-xs"
                onClick={() => {
                  setGpsConfirmed(true)
                  searchRef.current?.focus()
                }}
              >
                Chercher l'adresse
              </button>
              <button
                type="button"
                className="btn btn-xs"
                onClick={() => {
                  setGpsConfirmed(true)
                  if (!picking) onTogglePicking()
                }}
              >
                Placer a la main
              </button>
            </div>
          </div>
        )}

        {/* Photos d'abord : elles remplissent le reste toutes seules */}
        <div>
          <p className="label">Photos</p>
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-dashed border-line px-4 py-4 text-[13px] text-text-muted transition-colors hover:border-line-strong hover:text-text-soft">
            <span>
              {pending.length > 0
                ? `${pending.length} photo${pending.length > 1 ? 's' : ''} prete${pending.length > 1 ? 's' : ''}`
                : 'Choisir des photos'}
              <span className="mt-0.5 block text-[11px] text-text-muted/70">
                Date et position lues automatiquement
              </span>
            </span>
            <span className="btn btn-xs">Parcourir</span>
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                void onPickFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
          {exifNote && <p className="notice mt-2">{exifNote}</p>}
        </div>

        {/* Recherche d'adresse */}
        <div className="relative">
          <label className="label">Rechercher une adresse</label>
          <input
            ref={searchRef}
            className="field"
            value={query}
            onChange={(e) => {
              touchedRef.current = true
              setQuery(e.target.value)
            }}
            placeholder="Vienne, Autriche"
            autoComplete="off"
          />
          {searching && <p className="mt-1.5 text-[11px] text-text-muted">Recherche...</p>}
          {results.length > 0 && (
            <ul className="panel absolute z-30 mt-1.5 max-h-56 w-full overflow-y-auto p-1.5 shadow-xl">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => pick(r)}
                    className="block w-full rounded-lg px-3 py-2 text-left text-[13px] leading-snug text-text-soft transition-colors hover:bg-surface-2 hover:text-text"
                  >
                    {r.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Position */}
        <div className="rounded-xl border border-line bg-surface-2 px-4 py-3.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="label mb-1">Position</p>
              <p className="font-mono text-[12px] text-text-soft">
                {hasCoords ? `${draft.lat!.toFixed(5)}, ${draft.lng!.toFixed(5)}` : 'non definie'}
              </p>
            </div>
            <button
              type="button"
              onClick={onTogglePicking}
              className={`btn btn-xs ${picking ? 'btn-accent' : ''}`}
            >
              {picking ? 'Cliquez sur la carte' : 'Placer sur la carte'}
            </button>
          </div>
        </div>

        <div>
          <label className="label">Nom du lieu</label>
          <input
            className="field"
            value={draft.name}
            onChange={(e) => onDraftChange({ ...draft, name: e.target.value })}
            placeholder="Schonbrunn"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Pays</label>
            <input
              className="field"
              value={draft.country}
              onChange={(e) => onDraftChange({ ...draft, country: e.target.value })}
              placeholder="Autriche"
              required
            />
          </div>
          <div>
            <label className="label">Ville</label>
            <input
              className="field"
              value={draft.city}
              onChange={(e) => onDraftChange({ ...draft, city: e.target.value })}
              placeholder="Vienne"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">
              {draft.status === 'wishlist' ? 'Date visee' : 'Date de visite'}
            </label>
            <input
              className="field"
              type="date"
              value={draft.visit_date}
              onChange={(e) => onDraftChange({ ...draft, visit_date: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Voyage</label>
            <select
              className="field"
              value={draft.trip_id}
              onChange={(e) => onDraftChange({ ...draft, trip_id: e.target.value })}
            >
              <option value="">Lieu isole</option>
              {trips.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                  {t.status === 'planning' ? ' (a preparer)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label">Categorie</label>
          {categories.length > 0 && (
            <select
              className="field"
              value={draft.category_id}
              onChange={(e) => onDraftChange({ ...draft, category_id: e.target.value })}
            >
              <option value="">Sans categorie</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <div className="mt-2 flex gap-2">
            <input
              className="field"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="Creer une categorie"
            />
            <button
              type="button"
              className="btn btn-xs"
              disabled={!newCategory.trim() || busy}
              onClick={() => {
                const label = newCategory.trim()
                void addCategory(label, '#c4653d')
                  .then((created) => {
                    onDraftChange({ ...draft, category_id: created.id })
                    setNewCategory('')
                  })
                  .catch((err) => setError(errorMessage(err)))
              }}
            >
              Creer
            </button>
          </div>
        </div>

        <div>
          <label className="label">Notes</label>
          <textarea
            className="field min-h-24 resize-y"
            value={draft.notes}
            onChange={(e) => onDraftChange({ ...draft, notes: e.target.value })}
            placeholder="Ce qu'on a vu, mange, retenu..."
          />
        </div>

        {/* Budget, avis et bon plan : utile surtout pour un hotel ou un
            restaurant, replie tant qu'on n'en a pas besoin. */}
        <details className="rounded-2xl border border-line bg-surface-2 p-4">
          <summary className="cursor-pointer text-[13px] font-semibold">
            Budget, avis et bon plan
          </summary>

          <div className="mt-4 space-y-4">
            <div>
              <label className="label">Votre note</label>
              <Stars value={draft.rating} onChange={(rating) => onDraftChange({ ...draft, rating })} />
            </div>

            <div>
              <label className="label">Avis</label>
              <textarea
                className="field min-h-20 resize-y"
                value={draft.review}
                onChange={(e) => onDraftChange({ ...draft, review: e.target.value })}
                placeholder="Ce qu'on en a pense, ce qu'il faut savoir avant d'y aller..."
              />
            </div>

            <div>
              <label className="label">Fourchette de prix</label>
              <div className="flex gap-2">
                {PRICE_LEVELS.map((lvl) => (
                  <button
                    key={lvl.value}
                    type="button"
                    title={lvl.hint}
                    onClick={() =>
                      onDraftChange({
                        ...draft,
                        price_level: draft.price_level === lvl.value ? null : lvl.value,
                      })
                    }
                    className={`pill flex-1 justify-center ${
                      draft.price_level === lvl.value ? 'pill-active' : ''
                    }`}
                  >
                    {lvl.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="label">Depense sur place</label>
                <input
                  className="field"
                  inputMode="decimal"
                  value={draft.cost}
                  onChange={(e) => onDraftChange({ ...draft, cost: e.target.value })}
                  placeholder="120"
                />
              </div>
              <div>
                <label className="label">Devise</label>
                <select
                  className="field"
                  value={draft.currency}
                  onChange={(e) => onDraftChange({ ...draft, currency: e.target.value })}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="label">Bon plan</label>
              <input
                className="field"
                value={draft.promo_note}
                onChange={(e) => onDraftChange({ ...draft, promo_note: e.target.value })}
                placeholder="Deuxieme nuit offerte, menu du midi a 15 euros..."
              />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input
                  className="field font-mono"
                  value={draft.promo_code}
                  onChange={(e) => onDraftChange({ ...draft, promo_code: e.target.value })}
                  placeholder="CODE PROMO"
                />
                <input
                  className="field"
                  type="date"
                  value={draft.promo_until}
                  onChange={(e) => onDraftChange({ ...draft, promo_until: e.target.value })}
                  title="Valable jusqu'au"
                />
              </div>
            </div>
          </div>
        </details>

        {error && <p className="notice notice-bad">{error}</p>}
        {step && <p className="notice">{step}...</p>}

        <div className="flex gap-2 pb-4">
          <button type="submit" className="btn btn-accent flex-1" disabled={busy || !hasCoords}>
            {busy ? 'Enregistrement...' : 'Enregistrer'}
          </button>
          <button type="button" onClick={onCancel} className="btn btn-quiet">
            Annuler
          </button>
        </div>
      </form>
    </aside>
  )
}
