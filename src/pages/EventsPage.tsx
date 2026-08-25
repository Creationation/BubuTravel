import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePlaces } from '../context/PlacesContext'
import { errorMessage } from '../lib/errors'
import { RECURRENCES, formatEventDate, nextOccurrence, sortByNext } from '../lib/events'
import { formatMoney } from '../components/PlaceExtras'
import { plural } from '../lib/stats'
import type { TravelEvent } from '../lib/types'
import AppShell from '../components/AppShell'
import Reveal from '../components/Reveal'
import EventForm from '../components/EventForm'
import { useI18n, useT } from '../i18n/I18nContext'

export default function EventsPage() {
  const t = useT()
  const { events, places, trips, categories, removeEvent, loading } = usePlaces()
  const [editing, setEditing] = useState<TravelEvent | 'new' | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Une seule reference temporelle pour tout l'ecran : sinon deux appels a
  // new Date() dans le meme rendu pourraient classer un evenement des deux
  // cotes de la frontiere passe / a venir.
  const now = useMemo(() => new Date(), [])

  const { upcoming, past } = useMemo(() => {
    const sorted = sortByNext(events, now)
    return {
      upcoming: sorted.filter((e) => nextOccurrence(e, now) !== null),
      past: sorted.filter((e) => nextOccurrence(e, now) === null),
    }
  }, [events, now])

  const placeById = useMemo(() => new Map(places.map((p) => [p.id, p])), [places])
  const tripById = useMemo(() => new Map(trips.map((t) => [t.id, t])), [trips])
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-6xl px-5 pb-24 sm:px-8">
        <section className="border-b border-line py-12 sm:py-16">
          <Reveal>
            <p className="eyebrow">{t('nav.events')}</p>
            <div className="mt-4 flex flex-wrap items-end justify-between gap-5">
              <h1 className="display text-[clamp(2.2rem,6vw,4rem)]">
                {upcoming.length > 0 ? plural(upcoming.length, 'a venir', 'a venir') : t('events.calendar')}
              </h1>
              <button onClick={() => setEditing('new')} className="btn btn-accent">{t('events.new')}</button>
            </div>
            <p className="lede mt-5 max-w-xl">{t('events.intro')}</p>
          </Reveal>
        </section>

        {error && <p className="notice notice-bad mt-6">{error}</p>}

        {editing && (
          <div className="mt-8">
            <EventForm
              event={editing === 'new' ? undefined : editing}
              onDone={() => setEditing(null)}
              onCancel={() => setEditing(null)}
            />
          </div>
        )}

        {loading ? (
          <p className="mt-10 text-[13px] text-text-muted">{t('common.loading')}</p>
        ) : events.length === 0 && !editing ? (
          <Reveal className="mt-10">
            <div className="panel px-8 py-14 text-center">
              <h2 className="display-sm text-2xl">{t('events.emptyTitle')}</h2>
              <p className="lede mx-auto mt-3 max-w-md">{t('events.emptyBody')}</p>
              <button onClick={() => setEditing('new')} className="btn btn-accent mt-7">{t('events.createOne')}</button>
            </div>
          </Reveal>
        ) : (
          <>
            {upcoming.length > 0 && (
              <section className="mt-12">
                <Reveal className="mb-6">
                  <p className="eyebrow">{t('events.upcoming')}</p>
                </Reveal>
                <ul className="space-y-4">
                  {upcoming.map((event, i) => (
                    <EventCard
                      key={event.id}
                      event={event}
                      now={now}
                      delay={i * 50}
                      placeName={
                        event.place_id ? (placeById.get(event.place_id)?.name ?? null) : null
                      }
                      tripTitle={event.trip_id ? (tripById.get(event.trip_id)?.title ?? null) : null}
                      category={event.category_id ? (catById.get(event.category_id) ?? null) : null}
                      confirming={confirmId === event.id}
                      onEdit={() => setEditing(event)}
                      onDelete={() => {
                        if (confirmId !== event.id) {
                          setConfirmId(event.id)
                          return
                        }
                        void removeEvent(event.id).catch((err) => setError(errorMessage(err)))
                      }}
                    />
                  ))}
                </ul>
              </section>
            )}

            {past.length > 0 && (
              <section className="mt-14">
                <Reveal className="mb-6">
                  <p className="eyebrow">{t('events.past')}</p>
                </Reveal>
                <ul className="space-y-4 opacity-70">
                  {past.map((event, i) => (
                    <EventCard
                      key={event.id}
                      event={event}
                      now={now}
                      delay={i * 40}
                      placeName={
                        event.place_id ? (placeById.get(event.place_id)?.name ?? null) : null
                      }
                      tripTitle={event.trip_id ? (tripById.get(event.trip_id)?.title ?? null) : null}
                      category={event.category_id ? (catById.get(event.category_id) ?? null) : null}
                      confirming={confirmId === event.id}
                      onEdit={() => setEditing(event)}
                      onDelete={() => {
                        if (confirmId !== event.id) {
                          setConfirmId(event.id)
                          return
                        }
                        void removeEvent(event.id).catch((err) => setError(errorMessage(err)))
                      }}
                    />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </AppShell>
  )
}

function EventCard({
  event,
  now,
  delay,
  placeName,
  tripTitle,
  category,
  confirming,
  onEdit,
  onDelete,
}: {
  event: TravelEvent
  now: Date
  delay: number
  placeName: string | null
  tripTitle: string | null
  category: { name: string; color: string } | null
  confirming: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const { t, locale } = useI18n()
  const next = nextOccurrence(event, now)
  const repeat = RECURRENCES.find((r) => r.value === event.recurrence)

  return (
    <Reveal as="li" delay={delay}>
      <article className="panel p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {event.kind && <span className="eyebrow mb-0">{event.kind}</span>}
              {category && (
                <span
                  className="rounded-full px-2 py-0.5 text-[11px]"
                  style={{ background: `${category.color}22`, color: category.color }}
                >
                  {category.name}
                </span>
              )}
              {event.recurrence !== 'none' && repeat && (
                <span className="pill">{t(repeat.label)}</span>
              )}
            </div>

            <h3 className="display-sm mt-2 text-2xl">{event.title}</h3>

            <p className="mt-1.5 text-[13px] text-text-soft">
              {formatEventDate(event, locale, next)}
            </p>

            <p className="mt-1 text-[13px] text-text-muted">
              {placeName ?? event.venue ?? t('events.noPlace')}
              {tripTitle && ` · ${tripTitle}`}
            </p>

            {event.description && (
              <p className="mt-3 whitespace-pre-wrap text-[14px] leading-relaxed text-text-soft">
                {event.description}
              </p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <span className="pill">
                {event.is_free
                  ? t('events.free')
                  : event.price !== null
                    ? formatMoney(event.price, event.currency)
                    : t('events.noPrice')}
              </span>
              {event.organizer && <span className="pill">{event.organizer}</span>}
              {event.url && (
                <a href={event.url} target="_blank" rel="noreferrer" className="pill">{t('events.site')}</a>
              )}
            </div>

            {event.booking_note && (
              <p className="notice mt-3">{event.booking_note}</p>
            )}
          </div>

          <div className="flex shrink-0 gap-2">
            {event.place_id && (
              <Link to={`/carte?lieu=${event.place_id}`} className="btn btn-xs">{t('events.onMap')}</Link>
            )}
            <button onClick={onEdit} className="btn btn-xs btn-quiet">{t('common.edit')}</button>
            <button
              onClick={onDelete}
              className={`btn btn-xs ${confirming ? 'border-red-500/60 text-red-400' : 'btn-quiet'}`}
            >
              {confirming ? t('common.confirm') : t('common.delete')}
            </button>
          </div>
        </div>
      </article>
    </Reveal>
  )
}
