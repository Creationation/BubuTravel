import { useEffect, useState } from 'react'
import { errorMessage } from '../../lib/errors'
import { requestItinerary } from '../../lib/itinerary'
import type { AiItinerary, ItineraryRequest } from '../../lib/itinerary'
import { addDaysIso, nightsOf, shortDate, todayIso } from '../../lib/tripDates'
import type { Trip } from '../../lib/types'
import type { TripHub } from '../../lib/useTripHub'
import { useDraft } from '../../lib/drafts'
import { queueSights } from '../../lib/sights'
import { usePlaces } from '../../context/PlacesContext'
import type { TripStop } from '../../lib/types'
import { useAnalyzerOnline } from '../../lib/ideas'
import { useI18n } from '../../i18n/I18nContext'
import type { Key } from '../../i18n/fr'
import { modeKey } from './StopForm'
import { SparkIcon, TodoKindIcon, TransportIcon } from './icons'
import { countryName } from '../../lib/countryName'
import Portal from '../Portal'

const BUDGETS: { value: ItineraryRequest['budget']; label: Key }[] = [
  { value: 'petit', label: 'planner.budgetSmall' },
  { value: 'moyen', label: 'planner.budgetMid' },
  { value: 'confortable', label: 'planner.budgetComfort' },
  { value: 'luxe', label: 'planner.budgetLux' },
]
const PACES: { value: ItineraryRequest['pace']; label: Key }[] = [
  { value: 'tranquille', label: 'planner.paceSlow' },
  { value: 'equilibre', label: 'planner.paceEven' },
  { value: 'dense', label: 'planner.paceDense' },
]

type Form = {
  raw: string
  budget: ItineraryRequest['budget']
  pace: ItineraryRequest['pace']
  travellers: number
}

/**
 * Assistant d'itineraire, en panneau plein ecran. Le texte tape est garde en
 * brouillon : fermer l'app au milieu ne perd rien.
 */
export default function TripAssistant({
  trip,
  hub,
  onClose,
  onImported,
}: {
  trip: Trip
  hub: TripHub
  onClose: () => void
  onImported: () => void
}) {
  const { t, lang, locale } = useI18n()
  const draft = useDraft<Form>({
    key: `assistant:${trip.id}`,
    kind: 'assistant',
    tripId: trip.id,
    title: t('ai.title'),
    initial: { raw: '', budget: 'moyen', pace: 'equilibre', travellers: 2 },
    isEmpty: (v) => !v.raw.trim(),
  })
  const form = draft.value
  const online = useAnalyzerOnline()
  const { places } = usePlaces()
  const [plan, setPlan] = useState<AiItinerary | null>(null)
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Echap ferme le panneau ; le fond ne defile plus pendant ce temps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  async function generate() {
    setBusy(true)
    setError(null)
    setPlan(null)
    try {
      const result = await requestItinerary({
        raw: form.raw.trim(),
        start_date: trip.start_date,
        end_date: trip.end_date,
        travellers: form.travellers,
        budget: form.budget,
        pace: form.pace,
        nationality: '',
        lang,
        today: todayIso(),
        existing: hub.stops.map((s) => ({ name: s.name, arrive_date: s.arrive_date, leave_date: s.leave_date })),
      }, trip.id)
      setPlan(result)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function importPlan() {
    if (!plan) return
    setImporting(true)
    setError(null)
    try {
      const base = hub.stops.length ? Math.max(...hub.stops.map((s) => s.position)) + 1 : 0
      const created: TripStop[] = []
      for (const [i, s] of plan.stops.entries()) {
        const tr = s.transport_to_next
        const stop = await hub.addStop({
          position: base + i,
          name: s.name,
          country: s.country || null,
          lat: s.lat,
          lng: s.lng,
          arrive_date: s.arrive_date || null,
          leave_date: s.leave_date || null,
          stay_name: null,
          stay_address: null,
          stay_ref: null,
          stay_url: null,
          hosts: [],
          transport_mode: tr?.mode ?? null,
          transport_details: tr
            ? [tr.details, tr.how_to_book && `${t('ai.howToBook')} : ${tr.how_to_book}`].filter(Boolean).join(' · ')
            : null,
          transport_departs: null,
          transport_arrives: null,
          transport_ref: null,
          notes: [
            s.why,
            s.highlights.length ? `${t('ai.highlights')} :\n${s.highlights.map((h) => `• ${h}`).join('\n')}` : '',
            s.stay_tip,
          ]
            .filter(Boolean)
            .join('\n\n'),
        })
        created.push(stop)
        // Un trajet a reserver a l'avance devient un rappel date
        if (tr && tr.book_ahead_days > 0 && s.leave_date) {
          const due = addDaysIso(s.leave_date, -tr.book_ahead_days)
          await hub.addTodo({
            title: `${t('link.reminder', { name: `${t(modeKey(tr.mode))} ${s.name} → ${plan.stops[i + 1]?.name ?? ''}`.trim() })}`,
            kind: 'booking',
            due_at: `${due < todayIso() ? todayIso() : due}T00:00:00`,
            has_time: false,
            remind_minutes: 15 * 60,
            notes: tr.how_to_book || null,
          })
        }
      }
      for (const todo of plan.todos) {
        await hub.addTodo({
          title: todo.title,
          kind: todo.kind,
          due_at: todo.due_date ? `${todo.due_date}T00:00:00` : null,
          has_time: false,
          remind_minutes: todo.due_date ? 15 * 60 : null,
          notes: todo.notes || null,
        })
      }
      // Les incontournables de chaque etape arrivent ensuite sur la carte,
      // traites un par un par l'analyseur, sans bloquer l'ecran.
      await queueSights(created, places, lang).catch(() => undefined)
      draft.clear()
      onImported()
    } catch (err) {
      setError(errorMessage(err))
      setImporting(false)
    }
  }

  return (
    <Portal><div className="fixed inset-0 z-[1200] flex items-end justify-center bg-[#120d09]/55 backdrop-blur-sm sm:items-center sm:p-6">
      <div className="panel-enter flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[28px] border border-line bg-bg shadow-[var(--shadow-lg)] sm:rounded-[28px]">
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-7">
          <p className="eyebrow eyebrow-dot">{t('ai.title')}</p>
          <button onClick={onClose} className="btn btn-quiet btn-xs">
            {t('common.close')}
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-7">
          {!plan && (
            <div className="space-y-6">
              <div>
                <h2 className="display text-[2.4rem] sm:text-5xl">
                  {t('ai.headingA')} <em>{t('ai.headingEm')}</em> {t('ai.headingB')}
                </h2>
                <p className="lede mt-3 text-[15px]">{t('ai.intro')}</p>
              </div>

              <textarea
                className="field min-h-48 resize-y text-[15px] leading-relaxed"
                value={form.raw}
                onChange={(e) => draft.set({ ...form, raw: e.target.value })}
                placeholder={t('ai.placeholder')}
                autoFocus
              />

              <div className="grid gap-5 sm:grid-cols-[1fr_1fr_auto]">
                <div>
                  <label className="label">{t('ai.budget')}</label>
                  <div className="flex flex-wrap gap-1.5">
                    {BUDGETS.map((b) => (
                      <button
                        key={b.value}
                        type="button"
                        onClick={() => draft.set({ ...form, budget: b.value })}
                        className={`pill ${form.budget === b.value ? 'pill-active' : ''}`}
                      >
                        {t(b.label)}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="label">{t('ai.pace')}</label>
                  <div className="flex flex-wrap gap-1.5">
                    {PACES.map((p) => (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => draft.set({ ...form, pace: p.value })}
                        className={`pill ${form.pace === p.value ? 'pill-active' : ''}`}
                      >
                        {t(p.label)}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="label">{t('ai.travellers')}</label>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    className="field num w-20"
                    value={form.travellers}
                    onChange={(e) => draft.set({ ...form, travellers: Math.max(1, Number(e.target.value) || 1) })}
                  />
                </div>
              </div>

              {online !== null && (
                <p className={'chip ' + (online ? 'chip-ok' : 'chip-warn')}>{online ? t('ai.viaPc') : t('ai.pcOffline')}</p>
              )}
              {hub.stops.length > 0 && (
                <p className="notice">{t('ai.replaceWarning', { n: hub.stops.length })}</p>
              )}
              {error && <p className="notice notice-bad">{error}</p>}

              {busy && (
                <div className="card-feature flex items-center gap-4 p-5">
                  <span className="glyph animate-pulse">
                    <SparkIcon size={18} />
                  </span>
                  <p className="text-[14px] text-text-soft">{t('ai.generating')}</p>
                </div>
              )}
            </div>
          )}

          {plan && (
            <div className="space-y-8">
              <div>
                <p className="eyebrow">{t('ai.summary')}</p>
                <p className="display-sm mt-3 text-[1.45rem] leading-snug">{plan.summary}</p>
              </div>

              <section>
                <p className="eyebrow mb-4">{t('ai.stops')}</p>
                <ol className="space-y-3">
                  {plan.stops.map((s, i) => {
                    const nights = nightsOf(s)
                    return (
                      <li key={`${s.name}-${i}`} className="card p-4 sm:p-5">
                        <div className="flex items-start gap-3">
                          <span className="num flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line-strong text-[12px] font-semibold">
                            {i + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <h3 className="display-sm text-xl">
                                {s.name} <span className="text-[14px] text-text-muted">{countryName(s.country)}</span>
                              </h3>
                              <span className="num text-[12px] text-text-muted">
                                {shortDate(s.arrive_date, locale)} → {shortDate(s.leave_date, locale)}
                                {nights !== null && ` · ${nights === 1 ? t('hub.night') : t('hub.nights', { n: nights })}`}
                              </span>
                            </div>
                            <p className="mt-1.5 text-[13px] leading-relaxed text-text-soft">{s.why}</p>
                            {s.highlights.length > 0 && (
                              <div className="mt-2.5 flex flex-wrap gap-1.5">
                                {s.highlights.map((h) => (
                                  <span key={h} className="chip">
                                    {h}
                                  </span>
                                ))}
                              </div>
                            )}
                            {s.transport_to_next && (
                              <p className="mt-3 flex items-center gap-2 border-t border-dashed border-line pt-3 text-[12px] text-text-muted">
                                <TransportIcon mode={s.transport_to_next.mode} size={14} />
                                <span className="min-w-0 flex-1">
                                  {s.transport_to_next.details} ·{' '}
                                  {t('ai.duration', { h: Math.round(s.transport_to_next.duration_hours * 10) / 10 })}
                                  {s.transport_to_next.price_estimate > 0 &&
                                    ` · ~${Math.round(s.transport_to_next.price_estimate)} ${s.transport_to_next.currency}`}
                                </span>
                              </p>
                            )}
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ol>
              </section>

              {plan.todos.length > 0 && (
                <section>
                  <p className="eyebrow mb-3">{t('ai.todos')}</p>
                  <ul className="divide-y divide-line overflow-hidden rounded-[20px] border border-line bg-surface">
                    {plan.todos.map((todo, i) => (
                      <li key={i} className="flex items-start gap-3 px-4 py-3">
                        <span className="mt-0.5 text-text-muted">
                          <TodoKindIcon kind={todo.kind} size={15} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[14px]">{todo.title}</p>
                          {todo.notes && <p className="text-[12px] text-text-muted">{todo.notes}</p>}
                        </div>
                        {todo.due_date && (
                          <span className="chip num">{t('ai.dueBy', { date: shortDate(todo.due_date, locale) })}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {plan.admin.length > 0 && (
                <section>
                  <p className="eyebrow mb-3">{t('ai.admin')}</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {plan.admin.map((a, i) => (
                      <div key={i} className="card p-4">
                        <p className="text-[14px] font-semibold">{a.title}</p>
                        <p className="mt-1 text-[13px] leading-relaxed text-text-soft">{a.detail}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-[12px] text-text-muted">{t('ai.verify')}</p>
                </section>
              )}

              {error && <p className="notice notice-bad">{error}</p>}
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface px-5 py-4 sm:px-7">
          {plan ? (
            <>
              <button onClick={() => setPlan(null)} className="btn btn-quiet" disabled={importing}>
                {t('ai.again')}
              </button>
              <button onClick={importPlan} className="btn btn-accent btn-lg" disabled={importing}>
                {importing ? t('ai.importing') : t('ai.import')}
              </button>
            </>
          ) : (
            <button onClick={generate} className="btn btn-accent btn-lg" disabled={busy || form.raw.trim().length < 10}>
              <SparkIcon size={16} />
              {busy ? t('common.wait') : t('ai.generate')}
            </button>
          )}
        </footer>
      </div>
    </div></Portal>
  )
}
