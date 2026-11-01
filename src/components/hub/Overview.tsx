import { addDaysIso, currentAndNext, daysBetween, nowLocalIso, shortDate, shortDateTime, todayIso } from '../../lib/tripDates'
import type { Place, Trip } from '../../lib/types'
import { useNavigate } from 'react-router-dom'
import { usePlaces } from '../../context/PlacesContext'
import { flagOf } from '../../lib/countries'
import { isStay, photoScore } from '../../lib/schedule'
import type { TripHub } from '../../lib/useTripHub'
import { useI18n } from '../../i18n/I18nContext'
import { modeKey } from './StopForm'
import { DocIcon, RouteIcon, ShareIcon, ShieldIcon, TodoKindIcon, TransportIcon } from './icons'

export type HubTab = 'overview' | 'route' | 'todo' | 'docs' | 'countries' | 'ideas' | 'memories'

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

  const navigate = useNavigate()
  const { places } = usePlaces()
  const tripPlaces = places.filter((p) => p.trip_id === trip.id)
  const imageOf = (p: Place) => p.gallery?.find((u) => !u.includes('idea-frames')) || p.image_url || p.gallery?.[0] || null
  // Photo d'une etape : le plus beau lieu de la ville (paysage, monument)
  const cityImage = (name: string) => {
    const best = tripPlaces
      .filter((p) => norm(p.city) === norm(name) && imageOf(p))
      .sort((a, b) => photoScore(b) - photoScore(a))[0]
    return best ? imageOf(best) : null
  }
  const discover = tripPlaces
    .filter((p) => p.status === 'wishlist' && imageOf(p) && !isStay(p))
    .sort((a, b) => photoScore(b) - photoScore(a))
    .slice(0, 12)

  return (
    <div className="space-y-9">
      {/* Prochain trajet */}
      {nextTransportStop && (
        <button onClick={() => go('route')} className="card-feature block w-full p-5 text-left sm:p-6">
          <p className="eyebrow eyebrow-dot">{t('hub.nextTransport')}</p>
          <div className="mt-4 flex items-center gap-4">
            <span className="glyph h-12 w-12 bg-surface">
              <TransportIcon mode={nextTransportStop.transport_mode} size={22} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[1.4rem] font-extrabold">
                {nextTransportStop.name}
                {afterTransport && <span className="text-text-muted"> → </span>}
                {afterTransport?.name}
              </p>
              <p className="num mt-0.5 text-[14px] text-text-soft">
                {t(modeKey(nextTransportStop.transport_mode ?? 'other'))} · {shortDateTime(nextTransportStop.transport_departs, locale)}
              </p>
            </div>
          </div>
        </button>
      )}

      {/* Parcours : une grande carte photo par etape, qu'on fait defiler */}
      {hub.stops.length > 0 && (
        <section>
          <SectionHead title={t('ov.journey')} action={t('hub.allTodos')} onAction={() => go('route')} />
          <div className="nav-scroll -mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-2 sm:-mx-8 sm:px-8">
            {hub.stops.map((s, i) => {
              const img = cityImage(s.name)
              const nights = s.arrive_date && s.leave_date ? daysBetween(s.arrive_date, s.leave_date) : null
              const isNow = current?.id === s.id
              const isNext = !current && next?.id === s.id
              return (
                <button
                  key={s.id}
                  onClick={() => go('route')}
                  className="relative h-56 w-[72%] shrink-0 snap-start overflow-hidden rounded-[26px] text-left text-white shadow-[var(--shadow-md)] sm:w-72"
                >
                  {img ? (
                    <img src={img} alt="" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" />
                  ) : (
                    <div className="absolute inset-0 bg-[linear-gradient(135deg,#ff9a6b,#e2522c_50%,#7a3cb0)]" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
                  <span className="absolute left-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/25 text-[13px] font-extrabold backdrop-blur-md">
                    {i + 1}
                  </span>
                  {(isNow || isNext) && (
                    <span className="absolute right-3 top-3 rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-[#2a160d]">
                      {isNow ? t('ov.today') : t('ov.next')}
                    </span>
                  )}
                  <div className="absolute inset-x-0 bottom-0 p-4">
                    <p className="text-[12px] font-semibold opacity-85">
                      {s.country ? `${flagOf(s.country)} ` : ''}
                      {shortDate(s.arrive_date, locale)}
                      {s.leave_date ? ` → ${shortDate(s.leave_date, locale)}` : ''}
                    </p>
                    <p className="mt-0.5 text-[1.7rem] font-extrabold leading-tight">{s.name}</p>
                    <p className="mt-1 truncate text-[12px] opacity-85">
                      {nights !== null && `🌙 ${t('ov.nights', { n: nights })}`}
                      {s.stay_name && ` · 🏨 ${s.stay_name}`}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* A decouvrir : carrousel de lieux en photo */}
      {discover.length > 0 && (
        <section>
          <SectionHead title={t('ov.discover')} action={t('ov.seeMap')} onAction={() => navigate('/carte')} />
          <div className="nav-scroll -mx-5 flex snap-x gap-3 overflow-x-auto px-5 pb-2 sm:-mx-8 sm:px-8">
            {discover.map((p) => (
              <button
                key={p.id}
                onClick={() => navigate(`/carte?lieu=${p.id}`)}
                className="w-40 shrink-0 snap-start text-left sm:w-48"
              >
                <div className="aspect-[4/5] overflow-hidden rounded-[22px] bg-surface-2 shadow-[var(--shadow-sm)]">
                  <img src={imageOf(p)!} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                </div>
                <p className="mt-2 line-clamp-2 text-[14px] font-bold leading-snug">{p.name}</p>
                {p.city && <p className="text-[12px] text-text-muted">{p.city}</p>}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Listes facon reglages iOS */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <SectionHead title={t('hub.upcomingTodos')} action={t('hub.allTodos')} onAction={() => go('todo')} />
          <ul className="overflow-hidden rounded-[22px] border border-line bg-surface shadow-[var(--shadow-sm)]">
            {upcoming.length === 0 ? (
              <li className="px-4 py-4 text-[14px] text-text-muted">{t('todo.empty')}</li>
            ) : (
              upcoming.map((todo) => {
                const day = todo.due_at?.slice(0, 10)
                const late = day && day < today
                const inDays = day ? daysBetween(today, day) : null
                return (
                  <li key={todo.id}>
                    <button onClick={() => go('todo')} className="flex w-full items-center gap-3 border-b border-line px-4 py-3.5 text-left last:border-b-0 hover:bg-surface-2">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--halo)] text-accent">
                        <TodoKindIcon kind={todo.kind} size={15} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[15px]">{todo.title}</span>
                      {day && (
                        <span className={`chip num ${late ? 'chip-bad' : day <= addDaysIso(today, 3) ? 'chip-warn' : ''}`}>
                          {late ? t('hub.late') : inDays === 0 ? shortDate(day, locale) : t('hub.in', { n: inDays ?? 0 })}
                        </span>
                      )}
                      <span className="text-text-muted">›</span>
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        </section>

        <section>
          <SectionHead title={t('hub.essentialDocs')} action={t('hub.allDocs')} onAction={() => go('docs')} />
          <ul className="overflow-hidden rounded-[22px] border border-line bg-surface shadow-[var(--shadow-sm)]">
            {essentials.length === 0 ? (
              <li className="px-4 py-4 text-[14px] text-text-muted">{t('hub.startDocsHint')}</li>
            ) : (
              essentials.map((doc) => (
                <li key={doc.id}>
                  <button onClick={() => go('docs')} className="flex w-full items-center gap-3 border-b border-line px-4 py-3.5 text-left last:border-b-0 hover:bg-surface-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--halo)] text-accent">
                      <DocIcon kind={doc.kind} size={15} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[15px]">{doc.title}</span>
                    <span className="text-text-muted">›</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>
    </div>
  )
}

function SectionHead({ title, action, onAction }: { title: string; action: string; onAction: () => void }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-[1.35rem] font-extrabold tracking-tight">{title}</h2>
      <button onClick={onAction} className="shrink-0 text-[14px] font-semibold text-accent">
        {action}
      </button>
    </div>
  )
}

const norm = (s: string | null | undefined) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

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
