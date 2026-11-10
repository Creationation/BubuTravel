import { useState } from 'react'
import type { ReactNode } from 'react'
import { usePlaces } from '../../context/PlacesContext'
import { useFeedback } from '../../context/FeedbackContext'
import { errorMessage } from '../../lib/errors'
import { stopOnDay } from '../../lib/schedule'
import { shortDate } from '../../lib/tripDates'
import type { Place, Trip, TripTodo } from '../../lib/types'
import type { TripHub } from '../../lib/useTripHub'
import { useI18n } from '../../i18n/I18nContext'
import Portal from '../Portal'

const DURATIONS: { min: number; label: string }[] = [
  { min: 30, label: '30 min' },
  { min: 60, label: '1 h' },
  { min: 90, label: '1 h 30' },
  { min: 120, label: '2 h' },
  { min: 180, label: '3 h' },
  { min: 300, label: '5 h' },
  { min: 480, label: '1 j' },
]

function Sheet({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n()
  return (
    <Portal>
      <div className="fixed inset-0 z-[2700] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
        <div className="absolute inset-0 bg-[#120d09]/60" onClick={onClose} />
        <div className="sheet-in relative flex max-h-[94dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] bg-surface-solid shadow-[var(--shadow-lg)] sm:rounded-[28px]">
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <p className="text-[1.2rem] font-extrabold leading-tight">{title}</p>
              {sub && <p className="text-[12.5px] capitalize text-text-muted">{sub}</p>}
            </div>
            <button onClick={onClose} className="btn btn-quiet btn-xs shrink-0">
              {t('common.close')}
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">{children}</div>
        </div>
      </div>
    </Portal>
  )
}

/** Creer ou modifier une activite d'un jour (nom, jour, heure, duree, cout, notes). */
export function ActivityDialog({ trip, hub, day, place, onClose }: { trip: Trip; hub: TripHub; day: string; place?: Place; onClose: () => void }) {
  const { t, locale } = useI18n()
  const { add, edit, remove } = usePlaces()
  const fb = useFeedback()
  const [name, setName] = useState(place?.name ?? '')
  const [date, setDate] = useState(place?.visit_date ?? day)
  const [time, setTime] = useState(place?.plan_time ?? '')
  const [minutes, setMinutes] = useState<number | null>(place?.plan_minutes ?? null)
  const [cost, setCost] = useState(place?.cost != null ? String(place.cost) : '')
  const [currency, setCurrency] = useState(place?.currency ?? 'EUR')
  const [notes, setNotes] = useState(place?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!name.trim()) {
      setError(t('act.needName'))
      return
    }
    setBusy(true)
    setError(null)
    const c = Number(cost.replace(',', '.'))
    const fields = {
      name: name.trim().slice(0, 120), visit_date: date || null, plan_time: time || null, plan_minutes: minutes,
      cost: cost.trim() && Number.isFinite(c) ? c : null, currency: currency || 'EUR', notes: notes.trim() || null,
    }
    try {
      if (place) await edit(place.id, fields)
      else {
        const stop = stopOnDay(date || day, hub.stops) ?? hub.stops.find((s) => s.lat != null) ?? null
        await add({
          trip_id: trip.id, category_id: null, country: stop?.country ?? '', city: stop?.name ?? null,
          lat: stop?.lat ?? 0, lng: stop?.lng ?? 0, status: 'wishlist', planned_order: null,
          price_level: null, promo_code: null, promo_note: null, promo_until: null, rating: null, review: null,
          ...fields, notes: fields.notes ?? '',
        })
      }
      await hub.reload()
      onClose()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  async function unplace() {
    if (!place) return
    const before = { visit_date: place.visit_date, plan_time: place.plan_time }
    const ok = await fb.confirm({ title: t('fb.unplaceTitle'), subject: place.name, message: t('fb.unplaceMsg'), confirmLabel: t('fb.unplaceBtn'), danger: false, icon: '↩︎' })
    if (!ok) return
    setBusy(true)
    try {
      await edit(place.id, { visit_date: null, plan_time: null })
      fb.toast(t('fb.unplaced'), { icon: '↩︎', action: { label: t('fb.undo'), run: async () => { await edit(place.id, before); fb.toast(t('fb.restored')) } } })
      onClose()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  async function del() {
    if (!place) return
    setBusy(true)
    const done = await fb.confirmDelete({ title: t('fb.delActTitle'), subject: place.name, message: t('fb.delActMsg'), done: t('fb.actDeleted'), run: () => remove(place) })
    if (done) onClose()
    else setBusy(false)
  }

  return (
    <Sheet title={place ? `✏️ ${t('act.edit')}` : `＋ ${t('act.new')}`} sub={shortDate(date || day, locale, true)} onClose={onClose}>
      <label className="block">
        <span className="label">{t('act.name')}</span>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('act.namePh')} autoFocus={!place} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="label">{t('act.day')}</span>
          <input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">{t('act.time')}</span>
          <input className="field" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>
      <div>
        <span className="label">{t('act.duration')}</span>
        <div className="nav-scroll -mx-1 flex gap-1.5 overflow-x-auto px-1">
          {DURATIONS.map((d) => (
            <button key={d.min} type="button" onClick={() => setMinutes(minutes === d.min ? null : d.min)} className={`pill shrink-0 ${minutes === d.min ? 'pill-active' : ''}`}>
              {d.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-[1fr_5rem] gap-3">
        <label className="block">
          <span className="label">{t('act.cost')}</span>
          <input className="field num" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder={t('gap.optional')} />
        </label>
        <label className="block">
          <span className="label">{t('expenses.currency')}</span>
          <input className="field uppercase" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        </label>
      </div>
      <label className="block">
        <span className="label">{t('act.notes')}</span>
        <textarea className="field" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('act.notesPh')} />
      </label>

      {error && <p className="notice notice-bad">{error}</p>}

      <button onClick={() => void save()} disabled={busy} className="btn btn-accent w-full">
        {busy ? t('common.wait') : `✅ ${t('common.save')}`}
      </button>
      {place && (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => void unplace()} disabled={busy} className="btn btn-xs">
            ↩︎ {t('act.unplace')}
          </button>
          <button onClick={() => void del()} disabled={busy} className="btn btn-quiet btn-xs">
            🗑️ {t('act.delete')}
          </button>
        </div>
      )}
    </Sheet>
  )
}

/** Modifier une chose a faire depuis l'agenda : titre, jour, heure, notes, fait, supprimer. */
export function TodoDialog({ todo, hub, onClose }: { todo: TripTodo; hub: TripHub; onClose: () => void }) {
  const { t, locale } = useI18n()
  const fb = useFeedback()
  const cur = hub.todos.find((x) => x.id === todo.id) ?? todo
  const [title, setTitle] = useState(cur.title)
  const [date, setDate] = useState(cur.due_at?.slice(0, 10) ?? '')
  const [time, setTime] = useState(cur.has_time && cur.due_at ? cur.due_at.slice(11, 16) : '')
  const [notes, setNotes] = useState(cur.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function delTodo() {
    setBusy(true)
    const done = await fb.confirmDelete({ title: t('fb.delTodoTitle'), subject: cur.title, done: t('fb.todoDeleted'), run: () => hub.removeTodo(cur.id) })
    if (done) onClose()
    else setBusy(false)
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onClose()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Sheet title={`✅ ${t('todo.edit')}`} sub={date ? shortDate(date, locale, true) : undefined} onClose={onClose}>
      <label className="block">
        <span className="label">{t('act.name')}</span>
        <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="label">{t('act.day')}</span>
          <input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">{t('act.time')}</span>
          <input className="field" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>
      <label className="block">
        <span className="label">{t('act.notes')}</span>
        <textarea className="field" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {error && <p className="notice notice-bad">{error}</p>}
      <button
        onClick={() =>
          void run(() =>
            hub.editTodo(cur.id, {
              title: title.trim() || cur.title, notes: notes.trim() || null,
              due_at: date ? `${date}T${time || '09:00'}:00` : null, has_time: Boolean(date && time),
            }),
          )
        }
        disabled={busy}
        className="btn btn-accent w-full"
      >
        {busy ? t('common.wait') : `✅ ${t('common.save')}`}
      </button>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => void run(() => hub.editTodo(cur.id, { done: true }))} disabled={busy} className="btn btn-xs">
          ✔︎ {t('agenda.markDone')}
        </button>
        <button
          onClick={() => void delTodo()}
          disabled={busy}
          className="btn btn-quiet btn-xs"
        >
          🗑️ {t('act.delete')}
        </button>
      </div>
    </Sheet>
  )
}
