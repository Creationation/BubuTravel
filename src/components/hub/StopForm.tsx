import { useEffect, useRef, useState } from 'react'
import { searchPlaces } from '../../lib/geocode'
import type { GeoResult } from '../../lib/geocode'
import { errorMessage } from '../../lib/errors'
import { fromInputDateTime, toInputDateTime } from '../../lib/tripDates'
import type { NewTripStop, TransportMode, TripStop } from '../../lib/types'
import { useT } from '../../i18n/I18nContext'
import type { Key } from '../../i18n/fr'
import { PinIcon, TransportIcon } from './icons'

export const MODES: TransportMode[] = ['plane', 'train', 'bus', 'boat', 'car', 'taxi', 'motorbike', 'other']
export const modeKey = (m: TransportMode): Key => `mode.${m}` as Key

type Draft = Omit<NewTripStop, 'trip_id' | 'position'>

const EMPTY: Draft = {
  name: '',
  country: null,
  lat: null,
  lng: null,
  arrive_date: null,
  leave_date: null,
  stay_name: null,
  stay_address: null,
  stay_ref: null,
  stay_url: null,
  transport_mode: null,
  transport_details: null,
  transport_departs: null,
  transport_arrives: null,
  transport_ref: null,
  notes: null,
}

/**
 * Creation et modification d'une etape. Le lieu se cherche par son nom
 * (OpenStreetMap), ce qui donne ses coordonnees pour la carte du voyage.
 */
export default function StopForm({
  stop,
  defaultArrive,
  isLast,
  onSave,
  onCancel,
  onDelete,
}: {
  stop?: TripStop
  defaultArrive?: string | null
  isLast: boolean
  onSave: (draft: Draft) => Promise<unknown>
  onCancel: () => void
  onDelete?: () => Promise<unknown>
}) {
  const t = useT()
  const [draft, setDraft] = useState<Draft>(() =>
    stop ? { ...EMPTY, ...stripMeta(stop) } : { ...EMPTY, arrive_date: defaultArrive ?? null },
  )
  const [query, setQuery] = useState(stop?.name ?? '')
  const [results, setResults] = useState<GeoResult[]>([])
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showStay, setShowStay] = useState(Boolean(stop?.stay_name || stop?.stay_address || stop?.stay_ref))
  const [showTransport, setShowTransport] = useState(Boolean(stop?.transport_mode || stop?.transport_departs))
  const picked = useRef(Boolean(stop))

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  // Recherche du lieu, avec un petit delai pour ne pas interroger a chaque touche
  useEffect(() => {
    if (picked.current) return
    const q = query.trim()
    if (q.length < 3) {
      setResults([])
      return
    }
    const ctrl = new AbortController()
    const timer = window.setTimeout(async () => {
      setSearching(true)
      try {
        setResults(await searchPlaces(q, ctrl.signal))
      } catch {
        // Recherche indisponible : on garde le nom tape, sans coordonnees
      } finally {
        setSearching(false)
      }
    }, 450)
    return () => {
      ctrl.abort()
      window.clearTimeout(timer)
    }
  }, [query])

  function pick(r: GeoResult) {
    picked.current = true
    setQuery(r.name)
    setResults([])
    setDraft((d) => ({ ...d, name: r.name, country: r.country || null, lat: r.lat, lng: r.lng }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const name = (draft.name || query).trim()
    if (!name) return
    if (draft.arrive_date && draft.leave_date && draft.leave_date < draft.arrive_date) {
      setError(t('trips.endBeforeStart'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSave({ ...draft, name })
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="panel space-y-6 p-5 sm:p-7">
      <div className="flex items-center justify-between gap-3">
        <h3 className="display-sm text-2xl">{stop ? t('stop.edit') : t('stop.new')}</h3>
        <button type="button" onClick={onCancel} className="btn btn-quiet btn-xs">
          {t('common.cancel')}
        </button>
      </div>

      {error && <p className="notice notice-bad">{error}</p>}

      {/* Lieu */}
      <div className="relative">
        <label className="label">{t('stop.where')}</label>
        <div className="relative">
          <PinIcon size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            className="field pl-10"
            value={query}
            autoFocus={!stop}
            onChange={(e) => {
              picked.current = false
              setQuery(e.target.value)
              set('name', e.target.value)
            }}
            placeholder={t('stop.wherePlaceholder')}
          />
          {searching && (
            <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[11px] text-text-muted">
              {t('stop.searching')}
            </span>
          )}
        </div>
        {results.length > 0 && (
          <ul className="absolute inset-x-0 top-full z-20 mt-1.5 overflow-hidden rounded-2xl border border-line bg-surface-solid shadow-[var(--shadow-md)]">
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => pick(r)}
                  className="block w-full px-4 py-2.5 text-left transition-colors hover:bg-surface-2"
                >
                  <span className="block text-[14px] font-medium">{r.name}</span>
                  <span className="block truncate text-[12px] text-text-muted">{r.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Dates */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">{t('stop.arrive')}</label>
          <input
            type="date"
            className="field num"
            value={draft.arrive_date ?? ''}
            onChange={(e) => set('arrive_date', e.target.value || null)}
          />
        </div>
        <div>
          <label className="label">{t('stop.leave')}</label>
          <input
            type="date"
            className="field num"
            value={draft.leave_date ?? ''}
            min={draft.arrive_date ?? undefined}
            onChange={(e) => set('leave_date', e.target.value || null)}
          />
        </div>
      </div>

      {/* Hebergement */}
      <Section open={showStay} onToggle={() => setShowStay((v) => !v)} title={t('stop.stay')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('stop.stayName')} value={draft.stay_name} onChange={(v) => set('stay_name', v)} />
          <Field label={t('stop.stayRef')} value={draft.stay_ref} onChange={(v) => set('stay_ref', v)} />
          <Field
            label={t('stop.stayAddress')}
            value={draft.stay_address}
            onChange={(v) => set('stay_address', v)}
            className="sm:col-span-2"
          />
          <Field
            label={t('stop.stayUrl')}
            value={draft.stay_url}
            onChange={(v) => set('stay_url', v)}
            className="sm:col-span-2"
            type="url"
          />
        </div>
      </Section>

      {/* Transport vers la suite */}
      <Section
        open={showTransport}
        onToggle={() => setShowTransport((v) => !v)}
        title={isLast ? t('stop.transportLast') : t('stop.transport')}
      >
        <div className="space-y-3">
          <div>
            <label className="label">{t('stop.mode')}</label>
            <div className="flex flex-wrap gap-1.5">
              {MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => set('transport_mode', draft.transport_mode === m ? null : m)}
                  className={`pill ${draft.transport_mode === m ? 'pill-active' : ''}`}
                >
                  <TransportIcon mode={m} size={14} />
                  {t(modeKey(m))}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">{t('stop.departs')}</label>
              <input
                type="datetime-local"
                className="field num"
                value={toInputDateTime(draft.transport_departs)}
                onChange={(e) => set('transport_departs', fromInputDateTime(e.target.value))}
              />
            </div>
            <div>
              <label className="label">{t('stop.arrives')}</label>
              <input
                type="datetime-local"
                className="field num"
                value={toInputDateTime(draft.transport_arrives)}
                onChange={(e) => set('transport_arrives', fromInputDateTime(e.target.value))}
              />
            </div>
            <Field
              label={t('stop.transportDetails')}
              value={draft.transport_details}
              onChange={(v) => set('transport_details', v)}
              placeholder={t('stop.transportDetailsPlaceholder')}
            />
            <Field label={t('stop.transportRef')} value={draft.transport_ref} onChange={(v) => set('transport_ref', v)} />
          </div>
        </div>
      </Section>

      <div>
        <label className="label">{t('stop.notes')}</label>
        <textarea
          className="field min-h-24 resize-y"
          value={draft.notes ?? ''}
          onChange={(e) => set('notes', e.target.value || null)}
          placeholder={t('stop.notesPlaceholder')}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
        {onDelete ? (
          <button
            type="button"
            onClick={async () => {
              if (!confirmDelete) return setConfirmDelete(true)
              setBusy(true)
              try {
                await onDelete()
              } catch (err) {
                setError(errorMessage(err))
                setBusy(false)
              }
            }}
            className={`btn btn-xs ${confirmDelete ? 'border-red-500/60 text-red-500' : 'btn-quiet'}`}
            disabled={busy}
          >
            {confirmDelete ? t('stop.deleteConfirm') : t('stop.delete')}
          </button>
        ) : (
          <span />
        )}
        <button type="submit" className="btn btn-accent" disabled={busy || !(draft.name || query).trim()}>
          {busy ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </form>
  )
}

function stripMeta(stop: TripStop): Draft {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, trip_id, position, created_at, created_by, ...rest } = stop
  return rest
}

function Section({
  open,
  onToggle,
  title,
  children,
}: {
  open: boolean
  onToggle: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-line">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="text-[13px] font-semibold">{title}</span>
        <span className={`text-text-muted transition-transform ${open ? 'rotate-45' : ''}`}>+</span>
      </button>
      {open && <div className="border-t border-line px-4 pb-4 pt-4">{children}</div>}
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  className = '',
  placeholder,
  type = 'text',
}: {
  label: string
  value: string | null
  onChange: (v: string | null) => void
  className?: string
  placeholder?: string
  type?: string
}) {
  return (
    <div className={className}>
      <label className="label">{label}</label>
      <input
        type={type}
        className="field"
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value || null)}
      />
    </div>
  )
}
