import { useEffect, useMemo, useRef, useState } from 'react'
import { usePlaces } from '../../context/PlacesContext'
import { useScope } from '../../context/TripScope'
import { isStay } from '../../lib/schedule'
import { detectGaps } from '../../lib/gaps'
import { clearDayDone, fetchDayStatus, setDayDone, watchDayStatus } from '../../lib/dayStatus'
import type { Gap } from '../../lib/gaps'
import { addDaysIso, shortDate, todayIso } from '../../lib/tripDates'
import { updateStop } from '../../lib/tripApi'
import { placeName } from '../../lib/discover'
import type { Place, Trip, TripStop, TripTodo } from '../../lib/types'
import type { TripHub } from '../../lib/useTripHub'
import { useI18n } from '../../i18n/I18nContext'
import Portal from '../Portal'
import PlaceSheet from '../PlaceSheet'
import RouteSheet from '../RouteSheet'
import type { RoutePoint } from '../RouteSheet'
import { HostCards } from './HostContacts'
import GapsPanel, { GapSearch } from './GapsPanel'
import type { HubTab } from './Overview'
import { eachTicketDay, loadTickets } from '../../lib/tickets'
import type { Ticket } from '../../lib/tickets'
import TicketsSheet, { useTicketViewer } from '../TicketsSheet'
import TripCheck from './TripCheck'
import DayPicker from './DayPicker'
import { ActivityDialog, TodoDialog } from './AgendaEditors'
import { PencilIcon } from './icons'

type Missing = { type: 'nostop' | 'nostay' | 'notransport' | 'activity'; gap?: Gap }

type Entry = {
  key: string
  time: string
  icon: string
  title: string
  sub?: string
  kind: 'place' | 'arrive' | 'leave' | 'transport' | 'todo' | 'stayin' | 'stayout' | 'ticket' | 'missing' | 'done'
  ticket?: Ticket
  missing?: Missing[]
  reason?: string
  placeId?: string
  stop?: TripStop
  todo?: TripTodo
  day: string
}

/**
 * L'agenda du voyage, jour par jour, directement dans l'app : arrivees,
 * trajets, activites placees, choses a faire. Chaque ligne s'ouvre (fiche du
 * lieu, detail de l'etape, du trajet ou de la tache). Un bouton l'envoie
 * aussi vers le calendrier du telephone.
 */
export default function AgendaSheet({
  trip,
  hub,
  go,
  onExport,
  onClose,
}: {
  trip: Trip
  hub: TripHub
  go: (tab: HubTab) => void
  onExport: () => void | Promise<void>
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  const { places: allPlaces } = usePlaces()
  const scope = useScope()
  const places = useMemo(() => scope.places(allPlaces), [allPlaces, scope])
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Entry | null>(null)
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [showTickets, setShowTickets] = useState(false)
  const [check, setCheck] = useState(false)
  const [pick, setPick] = useState<string | null>(null)
  const [editPlace, setEditPlace] = useState<Place | null>(null)
  const [addDay, setAddDay] = useState<string | null>(null)
  const [editTodo, setEditTodo] = useState<TripTodo | null>(null)
  const doneKey = `bubutravel:doneDays:${trip.id}`
  const [doneDays, setDoneDays] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem(doneKey) ?? '{}') as Record<string, string>
    } catch {
      return {}
    }
  })
  const saveLocal = (next: Record<string, string>) => {
    try {
      localStorage.setItem(doneKey, JSON.stringify(next))
    } catch {
      /* stockage indisponible */
    }
  }
  // Partage entre voyageurs : la base fait foi des qu'elle repond ; sinon copie locale.
  useEffect(() => {
    let stop = false
    const pull = async () => {
      const remote = await fetchDayStatus(trip.id)
      if (stop || remote === null) return
      // Ce qui n'existait que sur ce telephone monte une fois dans la base
      let local: Record<string, string> = {}
      try {
        local = JSON.parse(localStorage.getItem(doneKey) ?? '{}') as Record<string, string>
      } catch {
        /* rien */
      }
      const merged = { ...remote }
      for (const [d, r] of Object.entries(local)) {
        if (!(d in remote)) {
          merged[d] = r
          void setDayDone(trip.id, d, r)
        }
      }
      setDoneDays(merged)
      saveLocal(merged)
    }
    void pull()
    const off = watchDayStatus(trip.id, () => void pull())
    return () => {
      stop = true
      off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id])
  const saveDone = (next: Record<string, string>) => {
    setDoneDays(next)
    saveLocal(next)
  }
  const markDone = (d: string, reason = '') => {
    saveDone({ ...doneDays, [d]: reason })
    void setDayDone(trip.id, d, reason)
  }
  const reopen = (d: string) => {
    const next = { ...doneDays }
    delete next[d]
    saveDone(next)
    void clearDayDone(trip.id, d)
  }
  const [reasonDay, setReasonDay] = useState<string | null>(null)
  const [reasonText, setReasonText] = useState('')
  const [gapOpen, setGapOpen] = useState<Gap | null>(null)
  const viewer = useTicketViewer()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    loadTickets().then(setTickets).catch(() => undefined)
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  const days = useMemo(() => {
    const map = new Map<string, Entry[]>()
    const add = (day: string | null | undefined, e: Omit<Entry, 'day'>) => {
      if (!day) return
      map.set(day, [...(map.get(day) ?? []), { ...e, day }])
    }
    for (const s of hub.stops) {
      add(s.arrive_date, { key: `a${s.id}`, time: '00:00', icon: '📍', title: t('agenda.arrive', { name: s.name }), kind: 'arrive', stop: s })
      // Hebergements : arrivee (14 h) et depart (11 h), chacun avec son nom et son adresse
      const stays = [s.stay_name, ...(s.hosts ?? []).map((h) => h.stay)].filter((x, i, a): x is string => Boolean(x) && a.indexOf(x) === i)
      stays.forEach((name, k) => {
        add(s.arrive_date, { key: `si${s.id}${k}`, time: '14:00', icon: '🏨', title: t('agenda.checkin', { name }), sub: k === 0 ? s.stay_address ?? undefined : undefined, kind: 'stayin', stop: s })
        if (k === 0) add(s.leave_date, { key: `so${s.id}${k}`, time: '11:00', icon: '🏨', title: t('agenda.checkout', { name }), kind: 'stayout', stop: s })
      })
      add(s.leave_date, { key: `l${s.id}`, time: '23:00', icon: '🧳', title: t('agenda.leave', { name: s.name }), kind: 'leave', stop: s })
      if (s.transport_departs) {
        const [d, h = '00:00'] = s.transport_departs.split('T')
        add(d, { key: `t${s.id}`, time: h.slice(0, 5), icon: '🚆', title: s.transport_details || t('agenda.transport'), sub: s.transport_ref ?? undefined, kind: 'transport', stop: s })
      }
    }
    for (const p of places) {
      if (p.trip_id !== trip.id || !p.visit_date || isStay(p)) continue
      add(p.visit_date, { key: `p${p.id}`, time: p.plan_time ?? '12:00', icon: '🎯', title: placeName(p), sub: p.city ?? undefined, kind: 'place', placeId: p.id })
    }
    for (const tk of tickets) {
      for (const d of eachTicketDay(tk)) add(d, { key: `tk${tk.id}${d}`, time: '10:00', icon: '🎟️', title: tk.title, sub: tk.from === tk.to ? undefined : `${shortDate(tk.from, locale)} → ${shortDate(tk.to, locale)}`, kind: 'ticket', ticket: tk })
    }
    for (const todo of hub.todos) {
      if (todo.done || !todo.due_at) continue
      if (scope.country && todo.country && !scope.isIn(todo.country)) continue
      add(todo.due_at.slice(0, 10), { key: `d${todo.id}`, time: todo.has_time ? todo.due_at.slice(11, 16) : '08:00', icon: '✅', title: todo.title, kind: 'todo', todo })
    }
    // Chaque jour a venir : ce qui manque, ligne par ligne (destination, logement, transport, activite)
    const from = scope.range?.from ?? trip.start_date
    const to = scope.range?.to ?? trip.end_date
    if (from && to) {
      const now = todayIso()
      const scoped = scope.range ? { ...trip, start_date: scope.range.from, end_date: scope.range.to } : trip
      const gaps = detectGaps(scoped, hub.stops, places, hub.docs)
      for (let d = from < now ? now : from, n = 0; d <= to && n < 400; d = addDaysIso(d, 1), n++) {
        if (d in doneDays) {
          add(d, { key: `done${d}`, time: '23:30', icon: '✅', title: t('agenda.dayDone'), sub: doneDays[d] || undefined, kind: 'done' })
          continue
        }
        const miss: Missing[] = []
        const nostop = gaps.find((g) => g.type === 'nostop' && g.from <= d && d <= g.to)
        if (nostop) miss.push({ type: 'nostop', gap: { ...nostop, id: `nostop:${d}`, from: d, to: d, days: 1 } })
        const nostay = gaps.find((g) => g.type === 'nostay' && g.from <= d && d < g.to)
        if (nostay) miss.push({ type: 'nostay', gap: nostay })
        const notr = gaps.find((g) => g.type === 'notransport' && (g.from === d || g.to === d))
        if (notr) miss.push({ type: 'notransport', gap: notr })
        const items = map.get(d) ?? []
        if (!items.some((x) => x.kind === 'place' || x.kind === 'ticket') && !nostop) miss.push({ type: 'activity' })
        if (miss.length === 0 && items.length > 0) continue
        if (miss.length === 0) miss.push({ type: 'nostop', gap: { id: `nostop:${d}`, type: 'nostop', from: d, to: d, days: 1 } })
        add(d, { key: `miss${d}`, time: '23:30', icon: '⚠️', title: t('agenda.missing'), kind: 'missing', missing: miss })
      }
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, items]) => ({ day, items: items.sort((x, y) => x.time.localeCompare(y.time)) }))
  }, [hub.stops, hub.todos, hub.docs, places, trip, t, scope, tickets, locale, doneDays])

  const today = todayIso()

  // A l'ouverture seulement : on se place sur le prochain jour. Ensuite l'agenda
  // ne bouge plus tout seul (avant, chaque mise a jour le renvoyait en haut).
  const placed = useRef(false)
  useEffect(() => {
    if (placed.current || days.length === 0 || !box.current) return
    placed.current = true
    const target = days.find((d) => d.day >= today) ?? days[0]
    const el = box.current.querySelector<HTMLElement>(`[data-day="${target.day}"]`)
    if (el) box.current.scrollTop = Math.max(0, el.offsetTop - 8)
  }, [days, today])

  function open(e: Entry) {
    if (e.kind === 'missing' || e.kind === 'done') return
    if (e.kind === 'todo' && e.todo) setEditTodo(e.todo)
    else if (e.kind === 'place' && e.placeId) setOpenId(e.placeId)
    else if (e.kind === 'ticket' && e.ticket) void viewer.open(e.ticket)
    else setDetail(e)
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-[2500] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
        <div className="absolute inset-0 bg-[#120d09]/55" onClick={onClose} />
        <div className="sheet-in relative flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-[28px] bg-surface-solid shadow-[var(--shadow-lg)] sm:rounded-[28px]">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <p className="truncate text-[1.2rem] font-extrabold">📅 {t('agenda.title')}</p>
              <p className="truncate text-[12px] text-text-muted">
                {trip.title}
                {scope.country ? ` · ${scope.country}` : ''}
              </p>
            </div>
            <button onClick={onClose} className="btn btn-quiet btn-xs shrink-0">
              {t('common.close')}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 border-b border-line px-5 py-3">
            <button onClick={() => setCheck(true)} className="btn btn-accent btn-xs">
              ✅ {t('chk.title')}
            </button>
            <button onClick={() => setShowTickets(true)} className="btn btn-xs">
              🎟️ {t('qb.tickets')}
            </button>
          </div>

          <div ref={box} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
            <GapsPanel trip={trip} hub={hub} />
            {days.length === 0 ? (
              <p className="py-10 text-center text-[14px] text-text-muted">{t('agenda.empty')}</p>
            ) : (
              <ol className="space-y-5">
                {days.map(({ day, items }) => (
                  <li key={day} data-day={day}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className={`text-[13px] font-extrabold capitalize ${day === today ? 'text-accent' : ''}`}>
                        {shortDate(day, locale, true)}
                        {day === today && ` · ${t('ov.today')}`}
                      </p>
                      <button onClick={() => setAddDay(day)} className="shrink-0 rounded-full bg-surface-2 px-3 py-1 text-[12px] font-bold text-text-soft active:scale-95">
                        ＋ {t('act.add')}
                      </button>
                    </div>
                    <ul className="space-y-1.5">
                      {items.map((e) =>
                        e.kind === 'missing' ? (
                          <li key={e.key} className="rounded-2xl border border-dashed border-[#b4533f]/60 bg-surface px-3 py-3">
                            <p className="mb-2 text-[12px] font-extrabold uppercase tracking-[0.08em] text-[#b4533f]">⚠️ {e.title}</p>
                            <ul className="space-y-1.5">
                              {e.missing!.map((m) => (
                                <li key={m.type} className="flex items-center gap-2.5">
                                  <span className="text-lg">{{ nostop: '🗺️', nostay: '🏨', notransport: '✈️', activity: '🎯' }[m.type]}</span>
                                  <span className="min-w-0 flex-1 text-[13.5px] font-semibold leading-snug">
                                    {m.type === 'nostop' ? t('agenda.m.nostop') : m.type === 'nostay' ? t('agenda.m.nostay', { city: m.gap?.city ?? '' }) : m.type === 'notransport' ? t('agenda.m.notransport', { a: m.gap?.city ?? '', b: m.gap?.toCity ?? '' }) : t('agenda.m.activity')}
                                  </span>
                                  <button
                                    onClick={() => (m.type === 'activity' ? setPick(e.day) : setGapOpen(m.gap!))}
                                    className="shrink-0 rounded-full bg-accent px-3 py-1.5 text-[12px] font-extrabold text-accent-ink active:scale-95"
                                  >
                                    ✨ {m.type === 'activity' ? t('agenda.choose') : t('gap.search')}
                                  </button>
                                </li>
                              ))}
                            </ul>
                            {reasonDay === e.day ? (
                              <div className="mt-3 space-y-2">
                                <input className="field" value={reasonText} onChange={(ev) => setReasonText(ev.target.value)} placeholder={t('agenda.reasonPh')} autoFocus />
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => {
                                      markDone(e.day, reasonText.trim())
                                      setReasonDay(null)
                                      setReasonText('')
                                    }}
                                    className="btn btn-accent btn-xs flex-1"
                                  >
                                    ✅ {t('agenda.markComplete')}
                                  </button>
                                  <button onClick={() => setReasonDay(null)} className="btn btn-quiet btn-xs">
                                    {t('common.cancel')}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button onClick={() => { setReasonDay(e.day); setReasonText('') }} className="mt-3 w-full rounded-xl bg-surface-2 py-2 text-[12.5px] font-bold text-text-soft active:scale-[0.98]">
                                ✅ {t('agenda.complete')}
                              </button>
                            )}
                          </li>
                        ) : e.kind === 'done' ? (
                          <li key={e.key} className="flex items-center gap-3 rounded-2xl bg-[rgba(124,135,103,0.14)] px-3 py-2.5">
                            <span className="text-lg">✅</span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[13.5px] font-semibold">{e.title}</span>
                              {e.sub && <span className="block truncate text-[12px] text-text-muted">{e.sub}</span>}
                            </span>
                            <button onClick={() => reopen(e.day)} className="shrink-0 text-[12px] font-bold text-accent">
                              {t('agenda.reopen')}
                            </button>
                          </li>
                        ) : (
                        <li key={e.key} className="flex items-stretch gap-1.5">
                          <button
                            onClick={() => open(e)}
                            className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-2.5 text-left transition-transform active:scale-[0.98]"
                          >
                            <span className="num w-11 shrink-0 text-[12px] font-bold text-accent">{e.time === '00:00' || e.time === '23:00' ? '' : e.time}</span>
                            <span className="text-lg">{e.icon}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[14px] font-semibold">{e.title}</span>
                              {e.sub && <span className="block truncate text-[12px] text-text-muted">{e.sub}</span>}
                            </span>
                            <span className="text-text-muted">›</span>
                          </button>
                          {(e.kind === 'place' || e.kind === 'todo') && (
                            <button
                              onClick={() => {
                                if (e.kind === 'todo' && e.todo) setEditTodo(e.todo)
                                else {
                                  const p = places.find((x) => x.id === e.placeId)
                                  if (p) setEditPlace(p)
                                }
                              }}
                              aria-label={t('common.edit')}
                              title={t('common.edit')}
                              className="btn btn-icon btn-quiet shrink-0 self-center"
                            >
                              <PencilIcon size={16} />
                            </button>
                          )}
                        </li>
                      )
                      )}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="border-t border-line p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await onExport()
                  setDone(true)
                } finally {
                  setBusy(false)
                }
              }}
              className="btn btn-accent w-full"
            >
              {busy ? t('agenda.preparing') : `📲 ${t('agenda.export')}`}
            </button>
            <p className="mt-2 text-center text-[11.5px] leading-snug text-text-muted">{done ? t('agenda.exportDone') : t('agenda.exportHint')}</p>
          </div>
        </div>
      </div>
      {openId && <PlaceSheet placeId={openId} onClose={() => setOpenId(null)} />}
      {viewer.node}
      {showTickets && <TicketsSheet onClose={() => setShowTickets(false)} />}
      {gapOpen && <GapSearch trip={trip} hub={hub} gap={gapOpen} autoLaunch onClose={() => setGapOpen(null)} />}
      {addDay && <ActivityDialog trip={trip} hub={hub} day={addDay} onClose={() => setAddDay(null)} />}
      {editPlace && <ActivityDialog trip={trip} hub={hub} day={editPlace.visit_date ?? today} place={editPlace} onClose={() => setEditPlace(null)} />}
      {editTodo && <TodoDialog todo={editTodo} hub={hub} onClose={() => setEditTodo(null)} />}
      {pick && <DayPicker trip={trip} hub={hub} day={pick} onFree={(d) => markDone(d, '')} onClose={() => setPick(null)} />}
      {check && <TripCheck trip={trip} hub={hub} go={go} onClose={() => setCheck(false)} />}
      {detail && <EntryDetail entry={detail} trip={trip} hub={hub} go={go} onClose={() => setDetail(null)} />}
    </Portal>
  )
}

/** Detail d'une ligne de l'agenda qui n'est pas un lieu : etape, trajet ou tache. */
function EntryDetail({
  entry,
  trip,
  hub,
  go,
  onClose,
}: {
  entry: Entry
  trip: Trip
  hub: TripHub
  go: (tab: HubTab) => void
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  const [route, setRoute] = useState<RoutePoint | null>(null)
  const [error, setError] = useState<string | null>(null)
  const s = entry.stop ? (hub.stops.find((x) => x.id === entry.stop!.id) ?? entry.stop) : undefined
  const todo = entry.todo ? (hub.todos.find((x) => x.id === entry.todo!.id) ?? entry.todo) : undefined
  const hasPoint = s && s.lat != null && s.lng != null
  const target: RoutePoint | null = hasPoint ? { lat: s!.lat!, lng: s!.lng!, name: s!.stay_name || s!.name } : null

  return (
    <div className="fixed inset-0 z-[2600] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-[#120d09]/55" onClick={onClose} />
      <div className="sheet-in relative max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-[28px] bg-surface-solid p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-[var(--shadow-lg)] sm:rounded-[28px]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[1.3rem] font-extrabold leading-tight">
              {entry.icon} {entry.title}
            </p>
            <p className="mt-1 text-[13px] capitalize text-text-muted">
              {shortDate(entry.day, locale, true)}
              {entry.time !== '00:00' && entry.time !== '23:00' ? ` · ${entry.time}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="btn btn-quiet btn-xs shrink-0">
            {t('common.close')}
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {/* Etape : arrivee ou depart */}
          {s && (entry.kind === 'arrive' || entry.kind === 'leave' || entry.kind === 'stayin' || entry.kind === 'stayout') && (
            <>
              <div className="rounded-2xl bg-surface-2 p-3.5 text-[13.5px] leading-relaxed">
                <p className="font-bold">
                  {s.name}
                  {s.country ? ` · ${s.country}` : ''}
                </p>
                <p className="num text-text-muted">
                  {[s.arrive_date, s.leave_date].filter(Boolean).map((d) => shortDate(d!, locale)).join(' → ')}
                </p>
                {s.stay_name && <p className="mt-2">🏨 {s.stay_name}</p>}
                {s.stay_address && <p className="text-text-muted">{s.stay_address}</p>}
                {s.stay_ref && <p className="num text-text-muted">{t('stop.booking')} {s.stay_ref}</p>}
                {s.stay_url && (
                  <a href={s.stay_url} target="_blank" rel="noreferrer" className="mt-1 inline-block font-semibold text-accent">
                    🔗 {t('stop.booking')}
                  </a>
                )}
              </div>
              <HostCards
                hosts={s.hosts}
                compact
                onSave={async (next) => {
                  await updateStop(s.id, { hosts: next })
                  await hub.reload()
                }}
              />
            </>
          )}

          {/* Trajet */}
          {s && entry.kind === 'transport' && (
            <div className="rounded-2xl bg-surface-2 p-3.5 text-[13.5px] leading-relaxed">
              <p className="font-bold">{s.transport_details || t('agenda.transport')}</p>
              {s.transport_departs && <p className="num text-text-muted">{t('stop.departs')} {s.transport_departs.replace('T', ' ')}</p>}
              {s.transport_arrives && <p className="num text-text-muted">{t('stop.arrives')} {s.transport_arrives.replace('T', ' ')}</p>}
              {s.transport_ref && <p className="num text-text-muted">{t('stop.booking')} {s.transport_ref}</p>}
            </div>
          )}

          {/* Chose a faire */}
          {todo && (
            <div className="rounded-2xl bg-surface-2 p-3.5 text-[13.5px] leading-relaxed">
              {todo.notes ? <p className="whitespace-pre-wrap">{todo.notes}</p> : <p className="text-text-muted">{t('agenda.noNotes')}</p>}
            </div>
          )}

          {error && <p className="notice notice-bad">{error}</p>}

          <div className="flex flex-wrap gap-2 pt-1">
            {target && (
              <button onClick={() => setRoute(target)} className="btn btn-accent btn-xs">
                🧭 {t('dir.title')}
              </button>
            )}
            {todo && (
              <button
                onClick={async () => {
                  try {
                    await hub.editTodo(todo.id, { done: true })
                    onClose()
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err))
                  }
                }}
                className="btn btn-accent btn-xs"
              >
                ✅ {t('agenda.markDone')}
              </button>
            )}
            <button
              onClick={() => {
                onClose()
                go(todo ? 'todo' : 'route')
              }}
              className="btn btn-xs"
            >
              {todo ? t('agenda.seeTodos') : `✏️ ${t('common.edit')} · ${t('agenda.seeRoute')}`}
            </button>
            {s && hasPoint && (
              <a href={`https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`} target="_blank" rel="noreferrer" className="btn btn-xs btn-quiet">
                📍 Maps
              </a>
            )}
          </div>
        </div>
      </div>
      {route && <RouteSheet to={route} tripId={trip.id} onClose={() => setRoute(null)} />}
    </div>
  )
}
