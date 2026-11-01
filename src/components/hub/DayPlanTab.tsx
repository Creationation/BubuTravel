import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAiJobs } from '../../context/AiJobsContext'
import { usePlaces } from '../../context/PlacesContext'
import { emojiOf, familyOf, imageOf } from '../../lib/discover'
import { durationOf, fmtMinutes, isStay, stopOf, stopOnDay, toHHMM, toMinutes } from '../../lib/schedule'
import { addDaysIso, shortDate, todayIso } from '../../lib/tripDates'
import type { Place, Trip } from '../../lib/types'
import type { TripHub } from '../../lib/useTripHub'
import { useI18n } from '../../i18n/I18nContext'
import AiGauge from '../AiGauge'
import PlaceSheet from '../PlaceSheet'

const GAP = 15 // minutes de trajet entre deux activites
const QUICK = ['day.ai.relax', 'day.ai.route', 'day.ai.dinner', 'day.ai.later', 'day.ai.rain'] as const

/**
 * Le plan du jour : la journee en liste d'horaires. On fait glisser une
 * activite (poignee ⠿) pour changer l'ordre, les heures se recalculent
 * toutes seules ; on ajoute une activite ; on demande a l'IA de refaire la
 * journee proprement. Tout reste annulable.
 */
export default function DayPlanTab({ trip, hub }: { trip: Trip; hub: TripHub }) {
  const { t, locale, lang } = useI18n()
  const { places, edit, add, remove } = usePlaces()
  const { queue, jobs } = useAiJobs()
  const [params, setParams] = useSearchParams()

  const days = useMemo(() => {
    const start = trip.start_date ?? hub.stops[0]?.arrive_date
    const end = trip.end_date ?? hub.stops[hub.stops.length - 1]?.leave_date ?? start
    if (!start || !end) return []
    const out: string[] = []
    for (let d = start; d <= end && out.length < 120; d = addDaysIso(d, 1)) out.push(d)
    return out
  }, [trip.start_date, trip.end_date, hub.stops])

  const tripPlaces = useMemo(() => places.filter((p) => p.trip_id === trip.id), [places, trip.id])
  const countOn = (d: string) => tripPlaces.filter((p) => p.visit_date === d && !isStay(p)).length

  const fallbackDay = () => {
    const today = todayIso()
    if (days.includes(today)) return today
    return days.find((d) => countOn(d) > 0) ?? days[0] ?? today
  }
  const day = params.get('jour') && days.includes(params.get('jour')!) ? params.get('jour')! : fallbackDay()
  const setDay = (d: string) => setParams({ onglet: 'day', jour: d }, { replace: true })

  const stop = stopOnDay(day, hub.stops)
  const items = useMemo(
    () =>
      tripPlaces
        .filter((p) => p.visit_date === day && !isStay(p))
        .sort((a, b) => (a.plan_time ?? '99').localeCompare(b.plan_time ?? '99')),
    [tripPlaces, day],
  )

  // Ordre affiche (mis a jour tout de suite au lacher, avant la base)
  const [order, setOrder] = useState<string[]>([])
  useEffect(() => setOrder(items.map((p) => p.id)), [items])
  const list = order.map((id) => items.find((p) => p.id === id)).filter(Boolean) as Place[]

  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('20:00')
  const [undoJob, setUndoJob] = useState<string | null>(null)

  const aiRunning = jobs.find((j) => j.kind === 'day_plan' && j.trip_id === trip.id && j.input?.day === day && (j.status === 'pending' || j.status === 'processing'))
  const aiDone = jobs.find((j) => j.kind === 'day_plan' && j.trip_id === trip.id && j.input?.day === day && j.status === 'ready')
  const aiResult = aiDone?.result as { summary?: string; undo?: { id: string; visit_date: string | null; plan_time: string | null; plan_minutes: number | null }[]; created?: string[] } | null

  /** Recalcule les heures dans le nouvel ordre, en gardant la 1re heure. */
  async function applyOrder(ids: string[]) {
    setOrder(ids)
    let t0 = list[0]?.plan_time ? toMinutes(list[0].plan_time) : 9 * 60
    for (const id of ids) {
      const p = items.find((x) => x.id === id)
      if (!p) continue
      const time = toHHMM(t0)
      if (p.plan_time !== time) await edit(p.id, { plan_time: time })
      t0 += durationOf(p) + GAP
    }
  }

  function move(id: string, dir: -1 | 1) {
    const i = order.indexOf(id)
    const j = i + dir
    if (j < 0 || j >= order.length) return
    const next = [...order]
    ;[next[i], next[j]] = [next[j], next[i]]
    void applyOrder(next)
  }

  async function undoAi() {
    if (!aiResult || !aiDone) return
    for (const u of aiResult.undo ?? []) await edit(u.id, { visit_date: u.visit_date, plan_time: u.plan_time, plan_minutes: u.plan_minutes })
    for (const id of aiResult.created ?? []) {
      const p = places.find((x) => x.id === id)
      if (p) await remove(p)
    }
    setUndoJob(aiDone.id)
  }

  const total = list.reduce((n, p) => n + durationOf(p), 0)

  if (days.length === 0) return <p className="text-[14px] text-text-muted">{t('day.noDates')}</p>

  return (
    <div className="space-y-6">
      {/* Les jours du voyage */}
      <DayStrip days={days} day={day} onPick={setDay} countOn={countOn} locale={locale} stops={hub.stops} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow eyebrow-dot">{stop ? `📍 ${stop.name}` : t('day.noStop')}</p>
          <h2 className="mt-1 text-[1.8rem] font-extrabold capitalize leading-tight">{shortDate(day, locale, true)}</h2>
          <p className="num text-[13px] text-text-muted">
            {list.length > 0 ? `${list.length} · ${fmtMinutes(total)}` : t('day.empty')}
          </p>
        </div>
        <button onClick={() => setAdding(true)} className="btn btn-accent">
          ＋ {t('day.add')}
        </button>
      </div>

      {/* La journee, a reordonner au doigt */}
      <SortableList
        items={list}
        onOpen={setOpenId}
        onMove={move}
        onDrop={(ids) => void applyOrder(ids)}
        onRemove={(p) => void edit(p.id, { visit_date: null, plan_time: null })}
        onTime={(p, time) => void edit(p.id, { plan_time: time })}
      />

      {/* L'IA refait la journee */}
      <div className="card-feature space-y-3 p-4">
        <p className="text-[15px] font-extrabold">🪄 {t('day.ai.title')}</p>
        <p className="text-[13px] text-text-muted">{t('day.ai.hoursHint')}</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="min-w-0">
            <span className="label">{t('day.ai.from')}</span>
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="field num" />
          </label>
          <label className="min-w-0">
            <span className="label">{t('day.ai.to')}</span>
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="field num" />
          </label>
        </div>
        <div className="nav-scroll -mx-1 flex gap-1.5 overflow-x-auto px-1">
          {QUICK.map((k) => (
            <button key={k} onClick={() => setInstruction(t(k))} className="pill shrink-0 text-[12px]">
              {t(k)}
            </button>
          ))}
        </div>
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={2}
          className="field"
          placeholder={t('day.ai.ph')}
        />
        {aiRunning ? (
          <AiGauge job={aiRunning} />
        ) : (
          <button
            disabled={toMinutes(endTime) <= toMinutes(startTime)}
            onClick={() => void queue('day_plan', { trip_id: trip.id, day, instruction: instruction.trim(), start_time: startTime, end_time: endTime, lang }, trip.id).then(() => setInstruction(''))}
            className="btn btn-accent w-full"
          >
            ✨ {t('day.ai.go')}
          </button>
        )}
        {aiResult && aiDone && aiDone.id !== undoJob && !aiRunning && (
          <div className="fade-in rounded-2xl bg-surface p-3 text-[13px] leading-snug">
            <p>✅ {aiResult.summary}</p>
            <button onClick={() => void undoAi()} className="btn btn-xs mt-2">
              ↩️ {t('day.ai.undo')}
            </button>
          </div>
        )}
        {toMinutes(endTime) <= toMinutes(startTime) && <p className="text-[12px] font-semibold text-danger">{t('day.ai.invalidHours')}</p>}
      </div>

      {adding && (
        <AddActivity
          day={day}
          trip={trip}
          stopCity={stop?.name ?? null}
          candidates={tripPlaces.filter((p) => !p.visit_date && !isStay(p) && p.status === 'wishlist' && (!stop || stopOf(p, hub.stops)?.id === stop.id))}
          nextTime={list.length ? toHHMM(toMinutes(list[list.length - 1].plan_time ?? '09:00') + durationOf(list[list.length - 1]) + GAP) : '09:00'}
          onClose={() => setAdding(false)}
          onPick={async (p, time) => {
            await edit(p.id, { visit_date: day, plan_time: time })
            setAdding(false)
          }}
          onCreate={async (name, time, minutes) => {
            const lat = stop?.lat ?? list[0]?.lat
            const lng = stop?.lng ?? list[0]?.lng
            if (lat == null || lng == null) return
            await add({
              trip_id: trip.id, category_id: null, name, country: stop?.country ?? '', city: stop?.name ?? null, lat, lng,
              visit_date: day, notes: null, status: 'wishlist', planned_order: null, cost: null, currency: 'EUR', price_level: null,
              promo_code: null, promo_note: null, promo_until: null, rating: null, review: null, plan_time: time, plan_minutes: minutes,
            })
            setAdding(false)
          }}
        />
      )}
      {openId && <PlaceSheet placeId={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function DayStrip({
  days,
  day,
  onPick,
  countOn,
  locale,
  stops,
}: {
  days: string[]
  day: string
  onPick: (d: string) => void
  countOn: (d: string) => number
  locale: string
  stops: TripHub['stops']
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-day="${day}"]`)
    const bar = ref.current
    if (el && bar) bar.scrollTo({ left: el.offsetLeft - bar.clientWidth / 2 + el.clientWidth / 2, behavior: 'smooth' })
  }, [day])
  return (
    <div ref={ref} className="nav-scroll -mx-5 flex gap-2 overflow-x-auto px-5 pb-1 sm:-mx-8 sm:px-8">
      {days.map((d) => {
        const n = countOn(d)
        const active = d === day
        const city = stopOnDay(d, stops)?.name
        const wd = new Date(`${d}T00:00:00`).toLocaleDateString(locale, { weekday: 'short' })
        return (
          <button
            key={d}
            data-day={d}
            onClick={() => onPick(d)}
            className={`flex w-[4.4rem] shrink-0 flex-col items-center rounded-2xl border px-2 py-2 transition-all duration-300 active:scale-95 ${
              active ? 'border-accent bg-[var(--halo)] shadow-[var(--shadow-sm)]' : 'border-line bg-surface'
            }`}
          >
            <span className="text-[11px] font-semibold capitalize text-text-muted">{wd}</span>
            <span className="num text-[1.3rem] font-extrabold leading-tight">{Number(d.slice(8))}</span>
            <span className="max-w-full truncate text-[10px] text-text-muted">{city ?? '·'}</span>
            <span className={`mt-1 h-1.5 w-1.5 rounded-full ${n ? 'bg-accent' : 'bg-transparent'}`} />
          </button>
        )
      })}
    </div>
  )
}

/**
 * Liste reordonnable au doigt : la carte saisie suit le doigt (transform,
 * aucune mise en page recalculee), les autres s'ecartent en douceur.
 */
function SortableList({
  items,
  onOpen,
  onMove,
  onDrop,
  onRemove,
  onTime,
}: {
  items: Place[]
  onOpen: (id: string) => void
  onMove: (id: string, dir: -1 | 1) => void
  onDrop: (ids: string[]) => void
  onRemove: (p: Place) => void
  onTime: (p: Place, time: string) => void
}) {
  const { t } = useI18n()
  const rows = useRef(new Map<string, HTMLLIElement>())
  const [drag, setDrag] = useState<{ id: string; startY: number; dy: number; heights: number[]; from: number } | null>(null)

  const target = (() => {
    if (!drag) return -1
    let i = drag.from
    let acc = drag.dy
    if (acc > 0) {
      while (i < items.length - 1 && acc > drag.heights[i + 1] / 2) {
        acc -= drag.heights[i + 1]
        i++
      }
    } else {
      while (i > 0 && -acc > drag.heights[i - 1] / 2) {
        acc += drag.heights[i - 1]
        i--
      }
    }
    return i
  })()

  function start(e: React.PointerEvent, id: string) {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const heights = items.map((p) => (rows.current.get(p.id)?.offsetHeight ?? 72) + 10)
    setDrag({ id, startY: e.clientY, dy: 0, heights, from: items.findIndex((p) => p.id === id) })
    navigator.vibrate?.(8)
  }
  function moveTo(e: React.PointerEvent) {
    if (drag) setDrag({ ...drag, dy: e.clientY - drag.startY })
  }
  function end() {
    if (!drag) return
    const ids = items.map((p) => p.id)
    const [moved] = ids.splice(drag.from, 1)
    ids.splice(target, 0, moved)
    setDrag(null)
    if (target !== drag.from) onDrop(ids)
  }

  if (items.length === 0) return null

  return (
    <ol className="relative space-y-2.5">
      {items.map((p, i) => {
        const dragging = drag?.id === p.id
        let shift = 0
        if (drag && !dragging) {
          const h = drag.heights[drag.from]
          if (drag.from < i && i <= target) shift = -h
          if (target <= i && i < drag.from) shift = h
        }
        const img = imageOf(p)
        return (
          <li
            key={p.id}
            ref={(el) => {
              if (el) rows.current.set(p.id, el)
            }}
            className={`relative flex items-center gap-3 rounded-[20px] border bg-surface p-2.5 ${
              dragging ? 'z-10 border-accent shadow-[var(--shadow-lg)]' : 'border-line shadow-[var(--shadow-sm)]'
            }`}
            style={{
              transform: dragging ? `translateY(${drag!.dy}px) scale(1.02)` : `translateY(${shift}px)`,
              transition: dragging ? 'box-shadow .2s' : 'transform .28s cubic-bezier(.22,1,.36,1)',
            }}
          >
            <input
              type="time"
              value={p.plan_time ?? ''}
              onChange={(e) => onTime(p, e.target.value)}
              className="num w-[4.6rem] shrink-0 rounded-xl bg-[var(--halo)] px-1.5 py-2 text-center text-[14px] font-extrabold text-accent"
            />
            <button onClick={() => onOpen(p.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
              <span className="h-12 w-12 shrink-0 overflow-hidden rounded-2xl bg-surface-2">
                {img ? (
                  <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-xl">{emojiOf(familyOf(p))}</span>
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-bold">{p.name}</span>
                <span className="num block text-[12px] text-text-muted">
                  {fmtMinutes(durationOf(p))}
                  {p.plan_time && ` · ${t('day.until', { time: toHHMM(toMinutes(p.plan_time) + durationOf(p)) })}`}
                </span>
              </span>
            </button>
            <div className="flex shrink-0 flex-col">
              <button onClick={() => onMove(p.id, -1)} disabled={i === 0} className="px-1 text-[13px] text-text-muted disabled:opacity-20" aria-label={t('day.up')}>
                ▲
              </button>
              <button onClick={() => onMove(p.id, 1)} disabled={i === items.length - 1} className="px-1 text-[13px] text-text-muted disabled:opacity-20" aria-label={t('day.down')}>
                ▼
              </button>
            </div>
            <span
              onPointerDown={(e) => start(e, p.id)}
              onPointerMove={moveTo}
              onPointerUp={end}
              onPointerCancel={end}
              className="flex h-11 w-8 shrink-0 cursor-grab touch-none select-none items-center justify-center text-[18px] text-text-muted active:cursor-grabbing"
              aria-label={t('day.drag')}
            >
              ⠿
            </span>
            <button onClick={() => onRemove(p)} className="absolute -right-1.5 -top-1.5 hidden h-6 w-6 items-center justify-center rounded-full border border-line bg-surface-solid text-[11px] text-text-muted shadow sm:flex" aria-label={t('day.remove')}>
              ✕
            </button>
          </li>
        )
      })}
    </ol>
  )
}

function AddActivity({
  day,
  stopCity,
  candidates,
  nextTime,
  onClose,
  onPick,
  onCreate,
}: {
  day: string
  trip: Trip
  stopCity: string | null
  candidates: Place[]
  nextTime: string
  onClose: () => void
  onPick: (p: Place, time: string) => Promise<void>
  onCreate: (name: string, time: string, minutes: number) => Promise<void>
}) {
  const { t, locale } = useI18n()
  const [time, setTime] = useState(nextTime)
  const [name, setName] = useState('')
  const [minutes, setMinutes] = useState(90)
  const [busy, setBusy] = useState(false)
  return (
    <div className="fade-in fixed inset-0 z-[2500] flex items-end justify-center bg-[#120d09]/50 sm:items-center" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="sheet-in flex max-h-[88dvh] w-full max-w-lg flex-col rounded-t-[28px] bg-surface-solid p-5 shadow-[var(--shadow-lg)] sm:rounded-[28px]"
      >
        <div className="flex items-center justify-between">
          <p className="text-[1.2rem] font-extrabold">
            ＋ {t('day.add')} · <span className="capitalize">{shortDate(day, locale)}</span>
          </p>
          <button onClick={onClose} className="btn btn-quiet btn-xs">
            {t('common.close')}
          </button>
        </div>
        <label className="label mt-4">{t('plan.time')}</label>
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="field num" />

        <div className="mt-4 overflow-y-auto">
          {candidates.length > 0 && (
            <>
              <p className="label">{t('day.fromList', { city: stopCity ?? '' })}</p>
              <ul className="space-y-1.5">
                {candidates.map((p) => (
                  <li key={p.id}>
                    <button
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true)
                        await onPick(p, time)
                      }}
                      className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-2 text-left active:scale-[0.98]"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-2">
                        {imageOf(p) ? <img src={imageOf(p)!} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" /> : emojiOf(familyOf(p))}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{p.name}</span>
                      <span className="text-accent">＋</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="label mt-4">{t('day.newOne')}</p>
          <div className="flex gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} className="field flex-1" placeholder={t('day.newPh')} />
            <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="field w-24">
              {[30, 60, 90, 120, 180, 240].map((m) => (
                <option key={m} value={m}>
                  {fmtMinutes(m)}
                </option>
              ))}
            </select>
          </div>
          <button
            disabled={!name.trim() || busy}
            onClick={async () => {
              setBusy(true)
              await onCreate(name.trim().slice(0, 120), time, minutes)
            }}
            className="btn btn-accent mt-3 w-full"
          >
            {t('day.create')}
          </button>
        </div>
      </div>
    </div>
  )
}
