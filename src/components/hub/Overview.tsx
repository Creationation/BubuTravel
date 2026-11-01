import { addDaysIso, currentAndNext, daysBetween, nowLocalIso, shortDate, shortDateTime, todayIso } from '../../lib/tripDates'
import type { Trip } from '../../lib/types'
import type { TripHub } from '../../lib/useTripHub'
import { useI18n } from '../../i18n/I18nContext'
import { modeKey } from './StopForm'
import { DocIcon, PinIcon, RouteIcon, ShareIcon, ShieldIcon, SparkIcon, TodoKindIcon, TransportIcon } from './icons'

export type HubTab = 'overview' | 'route' | 'todo' | 'docs' | 'ideas' | 'memories'

/**
 * Le tableau de bord du voyage : ce qui arrive, ce qu'il ne faut pas oublier
 * et les papiers les plus demandes, en un coup d'oeil.
 */
export default function Overview({
  trip,
  hub,
  go,
  onOpenAssistant,
  onOpenShare,
}: {
  trip: Trip
  hub: TripHub
  go: (tab: HubTab) => void
  onOpenAssistant: () => void
  onOpenShare: () => void
}) {
  const { t, locale } = useI18n()
  const today = todayIso()
  const now = nowLocalIso()
  const { current, next } = currentAndNext(hub.stops, today)

  const nextTransportStop = hub.stops.find((s) => s.transport_departs && s.transport_departs >= now) ?? null
  const afterTransport = nextTransportStop
    ? hub.stops[hub.stops.findIndex((s) => s.id === nextTransportStop.id) + 1]
    : undefined

  const upcoming = hub.todos
    .filter((x) => !x.done)
    .sort((a, b) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999'))
    .slice(0, 6)

  const essentials = hub.docs
    .filter((d) => ['passport', 'visa', 'insurance', 'flight'].includes(d.kind))
    .slice(0, 6)

  const empty = hub.stops.length === 0 && hub.todos.length === 0 && hub.docs.length === 0

  if (empty) {
    return (
      <div className="space-y-6">
        <p className="eyebrow eyebrow-dot">{t('hub.startHere')}</p>
        <div className="grid gap-4 md:grid-cols-3">
          <StartCard
            icon={<RouteIcon size={20} />}
            title={t('hub.startRoute')}
            hint={t('hub.startRouteHint')}
            action={t('ai.open')}
            onClick={onOpenAssistant}
            accent
          />
          <StartCard
            icon={<ShieldIcon size={20} />}
            title={t('hub.startDocs')}
            hint={t('hub.startDocsHint')}
            action={t('doc.add')}
            onClick={() => go('docs')}
          />
          <StartCard
            icon={<ShareIcon size={20} />}
            title={t('hub.startShare')}
            hint={t('hub.startShareHint')}
            action={t('share.invite')}
            onClick={onOpenShare}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
      <div className="space-y-5">
        {/* Prochain trajet */}
        {nextTransportStop && (
          <button onClick={() => go('route')} className="card-feature block w-full p-6 text-left sm:p-7">
            <p className="eyebrow eyebrow-dot">{t('hub.nextTransport')}</p>
            <div className="mt-5 flex items-center gap-4">
              <span className="glyph h-12 w-12 bg-surface">
                <TransportIcon mode={nextTransportStop.transport_mode} size={22} />
              </span>
              <div className="min-w-0">
                <p className="display-sm truncate text-[1.9rem]">
                  {nextTransportStop.name}
                  {afterTransport && <span className="text-text-muted"> → </span>}
                  {afterTransport?.name}
                </p>
                <p className="num mt-1 text-[14px] text-text-soft">
                  {t(modeKey(nextTransportStop.transport_mode ?? 'other'))} ·{' '}
                  {shortDateTime(nextTransportStop.transport_departs, locale)}
                </p>
              </div>
            </div>
            {(nextTransportStop.transport_details || nextTransportStop.transport_ref) && (
              <div className="mt-5 flex flex-wrap gap-2">
                {nextTransportStop.transport_details && (
                  <span className="chip">{nextTransportStop.transport_details}</span>
                )}
                {nextTransportStop.transport_ref && (
                  <span className="chip chip-accent num">{nextTransportStop.transport_ref}</span>
                )}
              </div>
            )}
          </button>
        )}

        {/* Etape en cours et suivante */}
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            { label: t('hub.currentStop'), stop: current },
            { label: t('hub.nextStop'), stop: next },
          ].map(({ label, stop }) =>
            stop ? (
              <button key={label} onClick={() => go('route')} className="card card-hover p-5 text-left">
                <p className="eyebrow">{label}</p>
                <p className="display-sm mt-3 text-2xl">{stop.name}</p>
                <p className="num mt-1 text-[13px] text-text-muted">
                  {shortDate(stop.arrive_date, locale, true)}
                  {stop.leave_date && `  ·  ${shortDate(stop.leave_date, locale, true)}`}
                </p>
                {stop.stay_name && (
                  <p className="mt-3 flex items-center gap-1.5 text-[13px] text-text-soft">
                    <PinIcon size={13} />
                    {stop.stay_name}
                  </p>
                )}
              </button>
            ) : null,
          )}
        </div>

        {hub.stops.length === 0 && (
          <button onClick={onOpenAssistant} className="card card-hover flex w-full items-center gap-4 p-5 text-left">
            <span className="glyph">
              <SparkIcon size={18} />
            </span>
            <span>
              <span className="block text-[15px] font-semibold">{t('hub.startRoute')}</span>
              <span className="block text-[13px] text-text-muted">{t('hub.startRouteHint')}</span>
            </span>
          </button>
        )}
      </div>

      <div className="space-y-5">
        {/* A ne pas oublier */}
        <section className="card p-5">
          <div className="flex items-center justify-between">
            <p className="eyebrow">{t('hub.upcomingTodos')}</p>
            <button onClick={() => go('todo')} className="text-[12px] font-semibold text-accent">
              {t('hub.allTodos')}
            </button>
          </div>
          {upcoming.length === 0 ? (
            <p className="mt-4 text-[14px] text-text-muted">{t('todo.empty')}</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {upcoming.map((todo) => {
                const day = todo.due_at?.slice(0, 10)
                const late = day && day < today
                const inDays = day ? daysBetween(today, day) : null
                return (
                  <li key={todo.id} className="flex items-center gap-3 py-2.5">
                    <span className="text-text-muted">
                      <TodoKindIcon kind={todo.kind} size={15} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[14px]">{todo.title}</span>
                    {day && (
                      <span className={`chip num ${late ? 'chip-bad' : day <= addDaysIso(today, 3) ? 'chip-warn' : ''}`}>
                        {late ? t('hub.late') : inDays === 0 ? shortDate(day, locale) : t('hub.in', { n: inDays ?? 0 })}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* Documents essentiels */}
        <section className="card p-5">
          <div className="flex items-center justify-between">
            <p className="eyebrow">{t('hub.essentialDocs')}</p>
            <button onClick={() => go('docs')} className="text-[12px] font-semibold text-accent">
              {t('hub.allDocs')}
            </button>
          </div>
          {essentials.length === 0 ? (
            <button onClick={() => go('docs')} className="mt-4 text-[14px] text-text-muted hover:text-text">
              {t('hub.startDocsHint')}
            </button>
          ) : (
            <ul className="mt-3 space-y-2">
              {essentials.map((doc) => (
                <li key={doc.id} className="flex items-center gap-3">
                  <span className="glyph h-8 w-8">
                    <DocIcon kind={doc.kind} size={14} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14px]">{doc.title}</span>
                  {doc.reference && <span className="num font-mono text-[12px] text-text-muted">{doc.reference}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {trip.start_date && trip.end_date && (
          <p className="num px-1 text-[12px] text-text-muted">
            {shortDate(trip.start_date, locale)} → {shortDate(trip.end_date, locale)}
          </p>
        )}
      </div>
    </div>
  )
}

function StartCard({
  icon,
  title,
  hint,
  action,
  onClick,
  accent = false,
}: {
  icon: React.ReactNode
  title: string
  hint: string
  action: string
  onClick: () => void
  accent?: boolean
}) {
  return (
    <button onClick={onClick} className={`${accent ? 'card-feature' : 'card card-hover'} flex flex-col p-6 text-left`}>
      <span className="glyph h-11 w-11">{icon}</span>
      <span className="display-sm mt-5 text-2xl">{title}</span>
      <span className="mt-2 text-[14px] leading-relaxed text-text-muted">{hint}</span>
      <span className={`mt-6 text-[13px] font-semibold ${accent ? 'text-accent' : 'text-text-soft'}`}>{action} →</span>
    </button>
  )
}
