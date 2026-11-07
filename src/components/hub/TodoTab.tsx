import { useEffect, useMemo, useState } from 'react'
import { errorMessage } from '../../lib/errors'
import { flagOf } from '../../lib/countries'
import { addDaysIso, shortDate, todayIso } from '../../lib/tripDates'
import type { TodoKind, TripStop, TripTodo } from '../../lib/types'
import type { TripHub } from '../../lib/useTripHub'
import { useI18n } from '../../i18n/I18nContext'
import type { Key } from '../../i18n/fr'
import { BellIcon, CheckIcon, TodoKindIcon, TrashIcon } from './icons'
import { countryName } from '../../lib/countryName'
import { TOPICS, topicOf } from '../../lib/discover'
import { useScope } from '../../context/TripScope'

export const KINDS: TodoKind[] = ['todo', 'booking', 'admin', 'packing']
const kindKey = (k: TodoKind): Key => `todo.kind.${k}` as Key

const REMINDERS: { value: number | null; label: Key }[] = [
  { value: null, label: 'todo.remind.none' },
  { value: 0, label: 'todo.remind.atTime' },
  { value: 60, label: 'todo.remind.1h' },
  { value: 180, label: 'todo.remind.3h' },
  { value: 15 * 60, label: 'todo.remind.dayBefore' },
  { value: 24 * 60 + 15 * 60, label: 'todo.remind.2days' },
  { value: 6 * 24 * 60 + 15 * 60, label: 'todo.remind.week' },
]

function timedReminder(allDayValue: number): number {
  if (allDayValue < 15 * 60) return allDayValue
  return Math.round((allDayValue + 9 * 60) / (24 * 60)) * 24 * 60
}

type Group = 'late' | 'soon' | 'later' | 'undated' | 'done'
const GROUPS: Group[] = ['late', 'soon', 'later', 'undated', 'done']

function groupOf(todo: TripTodo, today: string): Group {
  if (todo.done) return 'done'
  if (!todo.due_at) return 'undated'
  const day = todo.due_at.slice(0, 10)
  if (day < today) return 'late'
  if (day <= addDaysIso(today, 7)) return 'soon'
  return 'later'
}

/**
 * Les choses a faire, rangees par urgence. L'ajout tient en une ligne ; la
 * date, l'heure, le rappel et l'etape se reglent si on en a besoin.
 */
export default function TodoTab({ hub, autoAdd = false }: { hub: TripHub; autoAdd?: boolean }) {
  const { t } = useI18n()
  const [filter, setFilter] = useState<TodoKind | 'all'>('all')
  // Rangement : par theme (papiers, transport...) ou par urgence
  const [sortBy, setSortBy] = useState<'topic' | 'date'>('topic')
  // '*' = tous les pays, '' = check-list generale, sinon le nom du pays
  const [place, setPlace] = useState<string>('*')
  const [error, setError] = useState<string | null>(null)
  const today = todayIso()

  const countries = useMemo(() => {
    const list: string[] = []
    for (const s of hub.stops) if (s.country && !list.includes(s.country)) list.push(s.country)
    for (const x of hub.todos) if (x.country && !list.includes(x.country)) list.push(x.country)
    return list
  }, [hub.stops, hub.todos])

  const scope = useScope()
  const visible = hub.todos.filter(
    (todo) =>
      (filter === 'all' || todo.kind === filter) &&
      (place === '*' || (todo.country ?? '') === place) &&
      (!scope.country || !todo.country || scope.isIn(todo.country)),
  )
  const grouped = useMemo(() => {
    const map: Record<Group, TripTodo[]> = { late: [], soon: [], later: [], undated: [], done: [] }
    for (const todo of visible) map[groupOf(todo, today)].push(todo)
    for (const g of GROUPS) {
      map[g].sort((a, b) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999') || a.position - b.position)
    }
    return map
  }, [visible, today])

  const done = hub.todos.filter((x) => x.done).length
  const byTopic = useMemo(() => {
    const open = visible.filter((x) => !x.done)
    return TOPICS.map((tp) => ({
      ...tp,
      items: open
        .filter((x) => topicOf(x.title, x.notes, x.kind) === tp.id)
        .sort((a, b) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999') || a.position - b.position),
    })).filter((tp) => tp.items.length > 0)
  }, [visible])

  return (
    <div className="space-y-8">
      <AddTodo
        autoFocus={autoAdd}
        stops={hub.stops}
        countries={countries}
        defaultCountry={place === '*' ? '' : place}
        onAdd={(input) => hub.addTodo(input)}
        onError={setError}
      />
      {error && <p className="notice notice-bad">{error}</p>}

      {countries.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {[
            { value: '*', label: t('todo.all') },
            { value: '', label: t('todo.general') },
            ...countries.map((c) => ({ value: c, label: `${flagOf(c)} ${countryName(c)}` })),
          ].map((opt) => (
            <button
              key={opt.value || 'general'}
              onClick={() => setPlace(opt.value)}
              className={`pill ${place === opt.value ? 'pill-active' : ''}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="tabbar">
          <button onClick={() => setFilter('all')} className={`tab ${filter === 'all' ? 'tab-active' : ''}`}>
            {t('todo.all')}
          </button>
          {KINDS.map((k) => (
            <button key={k} onClick={() => setFilter(k)} className={`tab ${filter === k ? 'tab-active' : ''}`}>
              <TodoKindIcon kind={k} size={14} />
              {t(kindKey(k))}
            </button>
          ))}
        </div>
        {hub.todos.length > 0 && (
          <span className="num text-[13px] text-text-muted">
            {t('todo.progress', { done, total: hub.todos.length })}
          </span>
        )}
      </div>

      <div className="flex gap-1.5">
        <button onClick={() => setSortBy('topic')} className={`pill ${sortBy === 'topic' ? 'pill-active' : ''}`}>
          🗂️ {t('todo.byTopic')}
        </button>
        <button onClick={() => setSortBy('date')} className={`pill ${sortBy === 'date' ? 'pill-active' : ''}`}>
          📅 {t('todo.byDate')}
        </button>
      </div>

      {visible.length === 0 ? (
        <p className="py-10 text-center text-text-muted">{t('todo.empty')}</p>
      ) : sortBy === 'topic' ? (
        <>
          {byTopic.map((tp) => (
            <section key={tp.id}>
              <p className="mb-3 text-[15px] font-extrabold">
                {tp.emoji} {t(tp.label)} <span className="num text-[13px] font-medium text-text-muted">{tp.items.length}</span>
              </p>
              <ul className="overflow-hidden rounded-[20px] border border-line bg-surface">
                {tp.items.map((todo) => (
                  <TodoRow
                    key={todo.id}
                    todo={todo}
                    stops={hub.stops}
                    late={groupOf(todo, today) === 'late'}
                    onToggle={() => hub.editTodo(todo.id, { done: !todo.done }).catch((e) => setError(errorMessage(e)))}
                    onRemove={() => hub.removeTodo(todo.id).catch((e) => setError(errorMessage(e)))}
                  />
                ))}
              </ul>
            </section>
          ))}
          {grouped.done.length > 0 && (
            <section>
              <p className="eyebrow mb-3">
                {t('todo.group.done')} <span className="num font-medium normal-case tracking-normal">{grouped.done.length}</span>
              </p>
              <ul className="overflow-hidden rounded-[20px] border border-line bg-surface opacity-70">
                {grouped.done.map((todo) => (
                  <TodoRow
                    key={todo.id}
                    todo={todo}
                    stops={hub.stops}
                    late={false}
                    onToggle={() => hub.editTodo(todo.id, { done: !todo.done }).catch((e) => setError(errorMessage(e)))}
                    onRemove={() => hub.removeTodo(todo.id).catch((e) => setError(errorMessage(e)))}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      ) : (
        GROUPS.map((g) =>
          grouped[g].length === 0 ? null : (
            <section key={g}>
              <p className={`eyebrow mb-3 ${g === 'late' ? 'text-[#b4533f]' : ''}`}>
                {t(`todo.group.${g}` as Key)}
                <span className="num font-medium normal-case tracking-normal">{grouped[g].length}</span>
              </p>
              <ul className="overflow-hidden rounded-[20px] border border-line bg-surface">
                {grouped[g].map((todo) => (
                  <TodoRow
                    key={todo.id}
                    todo={todo}
                    stops={hub.stops}
                    late={g === 'late'}
                    onToggle={() =>
                      hub.editTodo(todo.id, { done: !todo.done }).catch((e) => setError(errorMessage(e)))
                    }
                    onRemove={() => hub.removeTodo(todo.id).catch((e) => setError(errorMessage(e)))}
                  />
                ))}
              </ul>
            </section>
          ),
        )
      )}
    </div>
  )
}

function TodoRow({
  todo,
  stops,
  late,
  onToggle,
  onRemove,
}: {
  todo: TripTodo
  stops: TripStop[]
  late: boolean
  onToggle: () => void
  onRemove: () => void
}) {
  const { t, locale } = useI18n()
  const stop = stops.find((s) => s.id === todo.stop_id)
  return (
    <li className="group flex items-start gap-3.5 border-b border-line px-4 py-3.5 last:border-b-0 sm:px-5">
      <button
        onClick={onToggle}
        className={`mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border transition-colors ${
          todo.done ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong hover:border-accent'
        }`}
        aria-label={todo.done ? t('planner.uncheck') : t('planner.check')}
      >
        {todo.done && <CheckIcon size={13} />}
      </button>
      <div className="min-w-0 flex-1">
        <p className={`text-[15px] leading-snug ${todo.done ? 'text-text-muted line-through' : ''}`}>{todo.title}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-text-muted">
          {todo.kind !== 'todo' && (
            <span className="chip">
              <TodoKindIcon kind={todo.kind} size={12} />
              {t(kindKey(todo.kind))}
            </span>
          )}
          {todo.due_at && (
            <span className={`chip num ${late ? 'chip-bad' : ''}`}>
              {shortDate(todo.due_at.slice(0, 10), locale, true)}
              {todo.has_time && ` ${todo.due_at.slice(11, 16)}`}
            </span>
          )}
          {todo.remind_minutes !== null && todo.due_at && (
            <span className="chip" title={t('todo.remind')}>
              <BellIcon size={12} />
            </span>
          )}
          {stop && <span className="chip">{stop.name}</span>}
        </div>
        {todo.notes && <p className="mt-1.5 text-[13px] text-text-soft">{todo.notes}</p>}
      </div>
      <button
        onClick={onRemove}
        className="btn btn-quiet btn-icon opacity-60 transition-opacity group-hover:opacity-100"
        aria-label={t('common.remove')}
      >
        <TrashIcon size={15} />
      </button>
    </li>
  )
}

function AddTodo({
  autoFocus = false,
  stops,
  countries,
  defaultCountry,
  onAdd,
  onError,
}: {
  autoFocus?: boolean
  stops: TripStop[]
  countries: string[]
  defaultCountry: string
  onAdd: (input: Partial<TripTodo> & { title: string }) => Promise<unknown>
  onError: (e: string | null) => void
}) {
  const { t } = useI18n()
  const [title, setTitle] = useState('')
  const [more, setMore] = useState(false)
  const [kind, setKind] = useState<TodoKind>('todo')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [remind, setRemind] = useState<number | null>(15 * 60)
  const [stopId, setStopId] = useState('')
  const [country, setCountry] = useState(defaultCountry)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  // Le filtre pays choisi en dessous devient le pays par defaut de l'ajout
  useEffect(() => setCountry(defaultCountry), [defaultCountry])

  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    onError(null)
    try {
      await onAdd({
        title: title.trim(),
        kind,
        due_at: date ? `${date}T${time || '00:00'}:00` : null,
        has_time: Boolean(date && time),
        // Les delais « veille / 2 jours / semaine » visent 9 h du matin pour
        // une journee entiere ; avec une heure precise, ce sont des jours pleins.
        remind_minutes: !date || remind === null ? null : date && time ? timedReminder(remind) : remind,
        stop_id: stopId || null,
        country: country || null,
        notes: notes.trim() || null,
      })
      setTitle('')
      setNotes('')
      setDate('')
      setTime('')
    } catch (err) {
      onError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="panel p-3 sm:p-4">
      <div className="flex gap-2">
        <input
          className="field border-transparent bg-transparent text-[15px] shadow-none focus:border-accent"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('todo.placeholder')}
          autoFocus={autoFocus}
        />
        <button type="submit" className="btn btn-accent" disabled={busy || !title.trim()}>
          {t('todo.add')}
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 px-1">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`pill ${kind === k ? 'pill-active' : ''}`}
          >
            <TodoKindIcon kind={k} size={13} />
            {t(kindKey(k))}
          </button>
        ))}
        <input
          type="date"
          className="field num ml-auto w-auto py-1.5 text-[12px]"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label={t('todo.when')}
        />
        <button type="button" onClick={() => setMore((v) => !v)} className="btn btn-quiet btn-xs">
          {t('todo.more')}
        </button>
      </div>

      {more && (
        <div className="mt-3 grid gap-3 border-t border-line px-1 pt-3 sm:grid-cols-3">
          <div>
            <label className="label">{t('todo.time')}</label>
            <input type="time" className="field num" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <div>
            <label className="label">{t('todo.remind')}</label>
            <select
              className="field"
              value={remind === null ? '' : String(remind)}
              onChange={(e) => setRemind(e.target.value === '' ? null : Number(e.target.value))}
            >
              {REMINDERS.map((r) => (
                <option key={r.label} value={r.value === null ? '' : String(r.value)}>
                  {t(r.label)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{t('todo.linkedStop')}</label>
            <select className="field" value={stopId} onChange={(e) => setStopId(e.target.value)}>
              <option value="">{t('todo.noStop')}</option>
              {stops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          {countries.length > 0 && (
            <div>
              <label className="label">{t('todo.country')}</label>
              <select className="field" value={country} onChange={(e) => setCountry(e.target.value)}>
                <option value="">{t('todo.general')}</option>
                {countries.map((c) => (
                  <option key={c} value={c}>
                    {countryName(c)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="sm:col-span-3">
            <label className="label">{t('todo.notes')}</label>
            <input className="field" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      )}
    </form>
  )
}
