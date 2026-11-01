import { useState } from 'react'
import { usePlaces } from '../../context/PlacesContext'
import { errorMessage } from '../../lib/errors'
import { searchPlaces } from '../../lib/geocode'
import { deleteIdea, retryIdea, updateIdea } from '../../lib/ideas'
import { createTodo } from '../../lib/tripApi'
import { addDaysIso, shortDate, todayIso } from '../../lib/tripDates'
import type { LinkIdea } from '../../lib/types'
import { useI18n } from '../../i18n/I18nContext'
import { CalendarIcon, ExternalIcon, PinIcon, SparkIcon, TrashIcon } from './icons'
import { countryName } from '../../lib/countryName'

const PLATFORM_LABEL: Record<string, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  youtube: 'YouTube',
  maps: 'Google Maps',
  web: 'Web',
}

/**
 * Une idee analysee : ce que c'est, ou, combien, quand y aller, et comment
 * l'ajouter au voyage (un lieu a visiter + un rappel de reservation).
 */
export default function IdeaCard({ idea, defaultTripId }: { idea: LinkIdea; defaultTripId?: string | null }) {
  const { t, locale } = useI18n()
  const { trips, add } = usePlaces()
  const a = idea.analysis
  const [tripId, setTripId] = useState<string>(idea.trip_id ?? defaultTripId ?? '')
  const [date, setDate] = useState<string>(a?.fit?.suggested_dates?.[0] ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showTranscript, setShowTranscript] = useState(false)

  async function save(intoTrip: boolean) {
    if (!a) return
    setBusy(true)
    setError(null)
    try {
      let lat = a.place.lat
      let lng = a.place.lng
      if (lat == null || lng == null) {
        const q = [a.place.name, a.place.city, a.place.country].filter(Boolean).join(', ')
        const hits = (await searchPlaces(q)).concat(
          a.place.city ? await searchPlaces(`${a.place.city}, ${a.place.country}`) : [],
        )
        if (hits[0]) {
          lat = hits[0].lat
          lng = hits[0].lng
        }
      }
      if (lat == null || lng == null) throw new Error(t('idea.placeNotFound'))

      const trip = intoTrip ? tripId || null : null
      const place = await add({
        trip_id: trip,
        category_id: null,
        name: a.name || a.place.name,
        country: a.place.country || '',
        city: a.place.city || null,
        lat,
        lng,
        visit_date: trip && date ? date : null,
        notes: [a.summary, a.booking && `${t('link.book')} : ${a.booking}`, a.booking_url, idea.url]
          .filter(Boolean)
          .join('\n\n'),
        status: 'wishlist',
        planned_order: null,
        cost: null,
        currency: 'EUR',
        price_level: null,
        promo_code: null,
        promo_note: null,
        promo_until: null,
        rating: null,
        review: null,
      })

      if (trip) {
        // Rappel de reservation, deux jours avant la date choisie
        const due = date ? addDaysIso(date, -2) : null
        await createTodo({
          trip_id: trip,
          title: t('link.reminder', { name: a.name }),
          kind: 'booking',
          due_at: due ? `${due < todayIso() ? todayIso() : due}T00:00:00` : null,
          has_time: false,
          remind_minutes: due ? 15 * 60 : null,
          notes: [a.booking, a.booking_url].filter(Boolean).join('\n') || null,
        })
      }
      await updateIdea(idea.id, { trip_id: trip, place_id: place.id })
      setDone(trip ? t('link.added') : t('idea.inWish'))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const header = (
    <div className="flex items-center gap-2 text-[12px] text-text-muted">
      <span className="chip">{PLATFORM_LABEL[idea.platform ?? 'web'] ?? 'Web'}</span>
      <a href={idea.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 truncate hover:text-text">
        <ExternalIcon size={12} />
        <span className="truncate">{t('idea.open')}</span>
      </a>
      <button
        onClick={async () => {
          if (!confirmDelete) return setConfirmDelete(true)
          try {
            await deleteIdea(idea.id)
          } catch (err) {
            setError(errorMessage(err))
          }
        }}
        className={`btn btn-xs ml-auto ${confirmDelete ? 'border-red-500/60 text-red-500' : 'btn-quiet'}`}
        aria-label={t('idea.delete')}
      >
        {confirmDelete ? t('doc.deleteConfirm') : <TrashIcon size={13} />}
      </button>
    </div>
  )

  if (idea.status !== 'ready' || !a) {
    return (
      <article className="card p-5">
        {header}
        <div className="mt-4 flex items-center gap-3">
          <span className={`glyph ${idea.status === 'error' ? 'text-[#b4533f]' : 'animate-pulse'}`}>
            <SparkIcon size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-medium">{idea.title || idea.url}</p>
            <p className="text-[13px] text-text-muted">
              {idea.status === 'error'
                ? `${t('idea.status.error')}${idea.error ? ` : ${idea.error}` : ''}`
                : idea.status === 'processing'
                  ? t('idea.status.processing')
                  : t('idea.status.pending')}
            </p>
          </div>
          {idea.status === 'error' && (
            <button onClick={() => void retryIdea(idea.id)} className="btn btn-xs">
              {t('idea.retry')}
            </button>
          )}
        </div>
        {idea.note && <p className="mt-3 text-[13px] text-text-soft">« {idea.note} »</p>}
        {error && <p className="notice notice-bad mt-3">{error}</p>}
      </article>
    )
  }

  const placed = Boolean(idea.place_id) || Boolean(done)

  return (
    <article className="card overflow-hidden">
      {idea.thumbnail && (
        <div className="relative h-44 overflow-hidden bg-surface-2">
          <img src={idea.thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/45 to-transparent" />
          {a.kind && <span className="chip absolute bottom-3 left-3 border-white/30 bg-black/30 text-white">{a.kind}</span>}
        </div>
      )}
      <div className="p-5">
        {header}
        <h3 className="display-sm mt-4 text-[1.6rem] leading-tight">{a.name}</h3>
        <p className="mt-1 flex items-center gap-1.5 text-[13px] text-text-muted">
          <PinIcon size={13} />
          {[a.place.name !== a.name ? a.place.name : '', a.place.city, countryName(a.place.country)].filter(Boolean).join(', ')}
        </p>
        <p className="mt-3 text-[14px] leading-relaxed text-text-soft">{a.summary}</p>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-[13px]">
          {a.price && <Info label={t('link.price')} value={a.price} />}
          {a.duration && <Info label={t('link.duration')} value={a.duration} />}
          {a.schedule && <Info label={t('idea.schedule')} value={a.schedule} />}
          {a.best_time && <Info label={t('idea.bestTime')} value={a.best_time} />}
        </dl>

        {a.booking && (
          <p className="mt-4 rounded-xl bg-surface-2 px-3.5 py-2.5 text-[13px]">
            <span className="font-semibold">{t('link.book')} : </span>
            {a.booking}
            {a.booking_url && (
              <a href={a.booking_url} target="_blank" rel="noreferrer" className="ml-1.5 font-semibold text-accent">
                ↗
              </a>
            )}
          </p>
        )}

        {a.fit && (
          <div className="card-feature mt-4 p-4">
            <p className="eyebrow eyebrow-dot">{t('link.bestStop')}</p>
            <p className="mt-2 text-[14px] font-semibold">
              {a.fit.stop_name ? t('link.fitsIn', { stop: a.fit.stop_name }) : t('link.noFit')}
            </p>
            {a.fit.reason && <p className="mt-1 text-[13px] text-text-soft">{a.fit.reason}</p>}
            {a.fit.suggested_dates.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {a.fit.suggested_dates.map((d) => (
                  <button
                    key={d}
                    onClick={() => setDate(d)}
                    className={`pill num ${date === d ? 'pill-active' : ''}`}
                    disabled={placed}
                  >
                    <CalendarIcon size={12} />
                    {shortDate(d, locale, true)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {a.tips.length > 0 && (
          <ul className="mt-4 space-y-1.5 text-[13px] text-text-soft">
            {a.tips.map((tip) => (
              <li key={tip} className="flex gap-2">
                <span className="text-accent">•</span>
                {tip}
              </li>
            ))}
          </ul>
        )}

        {a.transcript_excerpt && (
          <div className="mt-4">
            <button onClick={() => setShowTranscript((v) => !v)} className="text-[12px] font-semibold text-text-muted">
              {t('idea.transcript')} {showTranscript ? '−' : '+'}
            </button>
            {showTranscript && (
              <p className="mt-2 whitespace-pre-wrap rounded-xl bg-surface-2 p-3 text-[12px] leading-relaxed text-text-soft">
                {a.transcript_excerpt}
              </p>
            )}
          </div>
        )}

        {a.sources.length > 0 && (
          <p className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-muted">
            <span>{t('link.sources')} :</span>
            {a.sources.slice(0, 5).map((s) => (
              <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                {s.title || new URL(s.url).hostname}
              </a>
            ))}
          </p>
        )}

        {error && <p className="notice notice-bad mt-4">{error}</p>}

        <div className="mt-5 border-t border-line pt-4">
          {placed ? (
            <p className="chip chip-ok">{done ?? (idea.trip_id ? t('idea.inTrip') : t('idea.inWish'))}</p>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <select className="field" value={tripId} onChange={(e) => setTripId(e.target.value)}>
                  <option value="">{t('idea.noTrip')}</option>
                  {trips.map((trip) => (
                    <option key={trip.id} value={trip.id}>
                      {trip.title}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  className="field num"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  disabled={!tripId}
                  aria-label={t('idea.date')}
                />
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <button onClick={() => void save(false)} className="btn btn-quiet" disabled={busy}>
                  {t('idea.keepWish')}
                </button>
                <button onClick={() => void save(true)} className="btn btn-accent" disabled={busy || !tripId}>
                  {t('link.addToTrip')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">{label}</dt>
      <dd className="mt-0.5 text-text-soft">{value}</dd>
    </div>
  )
}
