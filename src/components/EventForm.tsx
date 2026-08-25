import { useState } from 'react'
import { usePlaces } from '../context/PlacesContext'
import { errorMessage } from '../lib/errors'
import { RECURRENCES, isoToLocalInput, localInputToIso } from '../lib/events'
import { CURRENCIES } from './PlaceExtras'
import type { TravelEvent } from '../lib/types'
import type { Key } from '../i18n/fr'
import { useT } from '../i18n/I18nContext'

type Props = {
  event?: TravelEvent
  onDone: (event: TravelEvent) => void
  onCancel: () => void
}

/** Suggestions de nature, pour reconnaitre un evenement d'un coup d'oeil. */
const KINDS: Key[] = [
  'kind.concert',
  'kind.festival',
  'kind.market',
  'kind.exhibition',
  'kind.show',
  'kind.sport',
  'kind.localFete',
  'kind.workshop',
]

export default function EventForm({ event, onDone, onCancel }: Props) {
  const t = useT()
  const { places, trips, categories, addEvent, editEvent } = usePlaces()

  const [form, setForm] = useState({
    title: event?.title ?? '',
    kind: event?.kind ?? '',
    description: event?.description ?? '',
    organizer: event?.organizer ?? '',
    url: event?.url ?? '',
    allDay: event?.all_day ?? false,
    startsAt: isoToLocalInput(event?.starts_at ?? null, event?.all_day),
    endsAt: isoToLocalInput(event?.ends_at ?? null, event?.all_day),
    recurrence: event?.recurrence ?? 'none',
    recurrenceUntil: event?.recurrence_until ?? '',
    isFree: event?.is_free ?? false,
    price: event?.price === null || event?.price === undefined ? '' : String(event.price),
    currency: event?.currency ?? 'EUR',
    bookingNote: event?.booking_note ?? '',
    placeId: event?.place_id ?? '',
    tripId: event?.trip_id ?? '',
    categoryId: event?.category_id ?? '',
    venue: event?.venue ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.startsAt) {
      setError(t('events.startRequired'))
      return
    }
    if (form.endsAt && form.endsAt < form.startsAt) {
      setError(t('events.endBeforeStart'))
      return
    }

    setBusy(true)
    setError(null)
    try {
      // Une journee entiere n'a pas d'heure : on la cale a minuit local
      const startIso = localInputToIso(form.allDay ? `${form.startsAt}T00:00` : form.startsAt)
      const endIso = form.endsAt
        ? localInputToIso(form.allDay ? `${form.endsAt}T23:59` : form.endsAt)
        : null

      const payload = {
        title: form.title.trim(),
        kind: form.kind.trim() || null,
        description: form.description.trim() || null,
        organizer: form.organizer.trim() || null,
        url: form.url.trim() || null,
        starts_at: startIso,
        ends_at: endIso,
        all_day: form.allDay,
        recurrence: form.recurrence,
        recurrence_until: form.recurrence === 'none' ? null : form.recurrenceUntil || null,
        is_free: form.isFree,
        price: form.isFree || !form.price.trim() ? null : Number(form.price.replace(',', '.')),
        currency: form.currency,
        booking_note: form.bookingNote.trim() || null,
        place_id: form.placeId || null,
        trip_id: form.tripId || null,
        category_id: form.categoryId || null,
        venue: form.placeId ? null : form.venue.trim() || null,
        // Les coordonnees ne servent que si l'evenement n'est pas sur un lieu
        lat: null,
        lng: null,
      }

      const result = event ? await editEvent(event.id, payload) : await addEvent(payload)
      onDone(result)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="panel space-y-5 p-6">
      <div>
        <label className="label">{t('events.title')}</label>
        <input
          className="field"
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder={t('events.titlePlaceholder')}
          required
          autoFocus
        />
      </div>

      <div>
        <label className="label">{t('events.kind')}</label>
        <input
          className="field"
          value={form.kind}
          onChange={(e) => set('kind', e.target.value)}
          placeholder={t('events.kindPlaceholder')}
          list="event-kinds"
        />
        <datalist id="event-kinds">
          {KINDS.map((k) => (
            <option key={k} value={t(k)} />
          ))}
        </datalist>
      </div>

      {/* Quand */}
      <div className="rounded-2xl border border-line bg-surface-2 p-4">
        <label className="mb-3 flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={form.allDay}
            onChange={(e) => {
              const allDay = e.target.checked
              // Basculer le mode change le format attendu par l'input
              setForm((prev) => ({
                ...prev,
                allDay,
                startsAt: prev.startsAt ? prev.startsAt.slice(0, allDay ? 10 : 16) : '',
                endsAt: prev.endsAt ? prev.endsAt.slice(0, allDay ? 10 : 16) : '',
              }))
            }}
          />{t('events.allDay')}</label>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">{t('trips.start')}</label>
            <input
              className="field"
              type={form.allDay ? 'date' : 'datetime-local'}
              value={form.startsAt}
              onChange={(e) => set('startsAt', e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">{t('trips.end')}</label>
            <input
              className="field"
              type={form.allDay ? 'date' : 'datetime-local'}
              value={form.endsAt}
              onChange={(e) => set('endsAt', e.target.value)}
            />
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">{t('events.recurrence')}</label>
            <select
              className="field"
              value={form.recurrence}
              onChange={(e) => set('recurrence', e.target.value as typeof form.recurrence)}
            >
              {RECURRENCES.map((r) => (
                <option key={r.value} value={r.value}>
                  {t(r.label)}
                </option>
              ))}
            </select>
          </div>
          {form.recurrence !== 'none' && (
            <div>
              <label className="label">{t('events.until')}</label>
              <input
                className="field"
                type="date"
                value={form.recurrenceUntil}
                onChange={(e) => set('recurrenceUntil', e.target.value)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Ou */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">{t('events.venuePlace')}</label>
          <select
            className="field"
            value={form.placeId}
            onChange={(e) => set('placeId', e.target.value)}
          >
            <option value="">{t('events.elsewhere')}</option>
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}, {p.country}
              </option>
            ))}
          </select>
        </div>
        {!form.placeId && (
          <div>
            <label className="label">{t('events.venue')}</label>
            <input
              className="field"
              value={form.venue}
              onChange={(e) => set('venue', e.target.value)}
              placeholder={t('events.venuePlaceholder')}
            />
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">{t('common.trip')}</label>
          <select className="field" value={form.tripId} onChange={(e) => set('tripId', e.target.value)}>
            <option value="">{t('common.none')}</option>
            {trips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t('common.category')}</label>
          <select
            className="field"
            value={form.categoryId}
            onChange={(e) => set('categoryId', e.target.value)}
          >
            <option value="">{t('common.none')}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Combien */}
      <div className="rounded-2xl border border-line bg-surface-2 p-4">
        <label className="mb-3 flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={form.isFree}
            onChange={(e) => set('isFree', e.target.checked)}
          />{t('events.free')}</label>

        {!form.isFree && (
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="label">{t('common.price')}</label>
              <input
                className="field"
                inputMode="decimal"
                value={form.price}
                onChange={(e) => set('price', e.target.value)}
                placeholder="25"
              />
            </div>
            <div>
              <label className="label">{t('common.currency')}</label>
              <select
                className="field"
                value={form.currency}
                onChange={(e) => set('currency', e.target.value)}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className="mt-3">
          <label className="label">{t('events.booking')}</label>
          <input
            className="field"
            value={form.bookingNote}
            onChange={(e) => set('bookingNote', e.target.value)}
            placeholder={t('events.bookingPlaceholder')}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">{t('events.organizer')}</label>
          <input
            className="field"
            value={form.organizer}
            onChange={(e) => set('organizer', e.target.value)}
            placeholder="Ville de Vienne"
          />
        </div>
        <div>
          <label className="label">{t('events.link')}</label>
          <input
            className="field"
            type="url"
            value={form.url}
            onChange={(e) => set('url', e.target.value)}
            placeholder="https://..."
          />
        </div>
      </div>

      <div>
        <label className="label">{t('events.description')}</label>
        <textarea
          className="field min-h-20 resize-y"
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder={t('events.descriptionPlaceholder')}
        />
      </div>

      {error && <p className="notice notice-bad">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" className="btn btn-accent" disabled={busy}>
          {busy ? t('common.saving') : event ? t('common.save') : t('events.createAction')}
        </button>
        <button type="button" onClick={onCancel} className="btn btn-quiet">{t('common.cancel')}</button>
      </div>
    </form>
  )
}
