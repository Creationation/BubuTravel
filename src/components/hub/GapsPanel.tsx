import { useMemo, useState } from 'react'
import { useAiJobs } from '../../context/AiJobsContext'
import type { AiJob } from '../../context/AiJobsContext'
import { usePlaces } from '../../context/PlacesContext'
import { errorMessage } from '../../lib/errors'
import { detectGaps } from '../../lib/gaps'
import type { Gap, GapType } from '../../lib/gaps'
import { addDaysIso, shortDate, todayIso } from '../../lib/tripDates'
import { updateStop } from '../../lib/tripApi'
import type { Trip, TransportMode } from '../../lib/types'
import type { TripHub } from '../../lib/useTripHub'
import { useI18n } from '../../i18n/I18nContext'
import type { Key } from '../../i18n/fr'
import AiGauge from '../AiGauge'
import Portal from '../Portal'

type Option = {
  title: string
  kind: 'stay' | 'transport' | 'activity' | 'stop'
  area: string
  why: string
  price_text: string
  price_eur: number
  detail: string
  url: string
  address: string
  lat: number | null
  lng: number | null
  mode: TransportMode
  depart_time: string
  pros: string[]
  cons: string[]
  sources: { title: string; url: string }[]
}
type Result = { summary: string; options: Option[] }

const ICON: Record<GapType, string> = { nostop: '🗺️', nostay: '🏨', notransport: '✈️', empty: '🎯' }
const CHIPS: Record<GapType, Key[]> = {
  nostay: ['gap.n.pool', 'gap.n.center', 'gap.n.breakfast', 'gap.n.quiet', 'gap.n.kitchen', 'gap.n.ac'],
  notransport: ['gap.n.cheap', 'gap.n.fast', 'gap.n.direct', 'gap.n.comfort'],
  empty: ['gap.n.culture', 'gap.n.nature', 'gap.n.food', 'gap.n.relax', 'gap.n.evening'],
  nostop: ['gap.n.beach', 'gap.n.nature', 'gap.n.city', 'gap.n.quiet'],
}

/**
 * Les trous du voyage, dans l'agenda : jours sans etape, etape sans logement,
 * trajet sans vol ou train, jours sans activite. Chaque trou a un bouton qui
 * demande a l'IA de chercher de vraies options selon le budget et les envies.
 */
export default function GapsPanel({ trip, hub }: { trip: Trip; hub: TripHub }) {
  const { t, locale } = useI18n()
  const { places } = usePlaces()
  const [open, setOpen] = useState<Gap | null>(null)
  const [showEmpty, setShowEmpty] = useState(false)
  const gaps = useMemo(() => detectGaps(trip, hub.stops, places, hub.docs), [trip, hub.stops, hub.docs, places])
  const important = gaps.filter((g) => g.type !== 'empty')
  const empties = gaps.filter((g) => g.type === 'empty')
  if (gaps.length === 0) return <p className="mb-5 rounded-2xl bg-[rgba(124,135,103,0.14)] px-4 py-3 text-[13.5px] font-semibold">✅ {t('gap.none')}</p>

  const label = (g: Gap) => {
    const range = g.from === g.to ? shortDate(g.from, locale) : `${shortDate(g.from, locale)} → ${shortDate(g.to, locale)}`
    if (g.type === 'nostop') return { title: t('gap.nostop', { n: g.days }), sub: range }
    if (g.type === 'nostay') return { title: t('gap.nostay', { city: g.city ?? '', n: g.days }), sub: range }
    if (g.type === 'notransport') return { title: t('gap.notransport', { a: g.city ?? '', b: g.toCity ?? '' }), sub: range }
    return { title: t('gap.empty', { city: g.city ?? '', n: g.days }), sub: range }
  }

  const card = (g: Gap) => {
    const l = label(g)
    return (
      <li key={g.id}>
        <button onClick={() => setOpen(g)} className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface px-3.5 py-3 text-left active:scale-[0.98]">
          <span className="text-2xl">{ICON[g.type]}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-bold leading-snug">{l.title}</span>
            <span className="num block text-[12px] text-text-muted">{l.sub}</span>
          </span>
          <span className="shrink-0 rounded-full bg-accent px-3 py-1.5 text-[12px] font-extrabold text-accent-ink">✨ {t('gap.search')}</span>
        </button>
      </li>
    )
  }

  return (
    <section className="mb-6">
      <p className="mb-2.5 text-[13px] font-extrabold uppercase tracking-[0.1em] text-[#b4533f]">
        ⚠️ {t('gap.title', { n: important.length })}
      </p>
      <ul className="space-y-2">{important.map(card)}</ul>
      {empties.length > 0 && (
        <div className="mt-3">
          <button onClick={() => setShowEmpty((v) => !v)} className="text-[12.5px] font-semibold text-text-muted">
            🎯 {t('gap.emptyTitle', { n: empties.reduce((n, g) => n + g.days, 0) })} {showEmpty ? '▴' : '▾'}
          </button>
          {showEmpty && <ul className="fade-in mt-2 space-y-2">{empties.map(card)}</ul>}
        </div>
      )}
      {open && <GapSearch trip={trip} hub={hub} gap={open} onClose={() => setOpen(null)} />}
    </section>
  )
}

function GapSearch({ trip, hub, gap, onClose }: { trip: Trip; hub: TripHub; gap: Gap; onClose: () => void }) {
  const { t, lang, locale } = useI18n()
  const { queue, jobs } = useAiJobs()
  const { add } = usePlaces()
  const [budget, setBudget] = useState(trip.budget ? '' : '')
  const [currency, setCurrency] = useState(trip.budget_currency ?? 'EUR')
  const [needs, setNeeds] = useState('')
  const [travelers, setTravelers] = useState(Math.max(1, hub.people.length || 2))
  const [error, setError] = useState<string | null>(null)
  const [applied, setApplied] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState<number | null>(null)

  const mine = jobs.filter((j: AiJob) => j.kind === 'gap_search' && j.trip_id === trip.id && (j.input?.gap as Gap | undefined)?.id === gap.id)
  const running = mine.find((j) => j.status === 'pending' || j.status === 'processing')
  const ready = mine.find((j) => j.status === 'ready')
  const failed = !running && !ready ? mine.find((j) => j.status === 'error') : undefined
  const result = ready?.result as unknown as Result | null

  async function launch() {
    setError(null)
    setApplied(new Set())
    try {
      const b = Number(budget.replace(',', '.'))
      await queue('gap_search', { gap, budget: Number.isFinite(b) && b > 0 ? b : null, currency, needs: needs.trim(), travelers, lang }, trip.id)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function apply(o: Option, i: number) {
    setBusy(i)
    setError(null)
    try {
      if (o.kind === 'stay' && gap.stopId) {
        const stop = hub.stops.find((s) => s.id === gap.stopId)
        const hosts = [...(stop?.hosts ?? []), { stay: o.title, name: '', phone: '', email: '', note: [o.price_text, o.detail].filter(Boolean).join(' · ') }]
        await updateStop(gap.stopId, { stay_name: o.title, stay_address: o.address || o.area || null, stay_url: o.url || null, hosts })
      } else if (o.kind === 'transport' && gap.stopId) {
        await updateStop(gap.stopId, {
          transport_mode: o.mode,
          transport_details: [o.title, o.detail].filter(Boolean).join(' · ').slice(0, 300),
          transport_departs: `${gap.from}T${o.depart_time || '09:00'}`,
        })
        const due = addDaysIso(gap.from, -14)
        await hub.addTodo({
          title: t('gap.bookTodo', { name: o.title }), kind: 'booking',
          due_at: `${due < todayIso() ? todayIso() : due}T09:00:00`, has_time: false,
          notes: [o.price_text, o.url].filter(Boolean).join('\n') || null,
        })
      } else if (o.kind === 'activity') {
        const stop = hub.stops.find((s) => s.id === gap.stopId)
        const lat = o.lat ?? stop?.lat
        const lng = o.lng ?? stop?.lng
        if (lat == null || lng == null) throw new Error(t('chat.noPlace'))
        const place = await add({
          trip_id: trip.id, category_id: null, name: o.title.slice(0, 120), country: gap.country ?? stop?.country ?? '', city: gap.city ?? null, lat, lng,
          visit_date: gap.from, notes: [o.why, o.url].filter(Boolean).join('\n\n'), status: 'wishlist', planned_order: null, cost: null, currency: 'EUR',
          price_level: null, promo_code: null, promo_note: null, promo_until: null, rating: null, review: null, plan_time: o.depart_time || null, plan_minutes: null,
        })
        void queue('place_info', { place_id: place.id, lang }, trip.id).catch(() => undefined)
      } else if (o.kind === 'stop') {
        await hub.addStop({
          name: o.title, country: gap.country ?? null, lat: o.lat, lng: o.lng, arrive_date: gap.from, leave_date: gap.to,
          stay_name: null, stay_address: null, stay_ref: null, stay_url: null, hosts: [],
          transport_mode: null, transport_details: null, transport_departs: null, transport_arrives: null, transport_ref: null,
          notes: [o.why, o.detail].filter(Boolean).join('\n'),
        })
      }
      await hub.reload()
      setApplied((s) => new Set(s).add(i))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const range = gap.from === gap.to ? shortDate(gap.from, locale) : `${shortDate(gap.from, locale)} → ${shortDate(gap.to, locale)}`
  const title =
    gap.type === 'notransport' ? t('gap.notransport', { a: gap.city ?? '', b: gap.toCity ?? '' })
    : gap.type === 'nostay' ? t('gap.nostay', { city: gap.city ?? '', n: gap.days })
    : gap.type === 'empty' ? t('gap.empty', { city: gap.city ?? '', n: gap.days })
    : t('gap.nostop', { n: gap.days })

  return (
    <Portal>
      <div className="fixed inset-0 z-[2700] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
        <div className="absolute inset-0 bg-[#120d09]/60" onClick={onClose} />
        <div className="sheet-in relative flex max-h-[94dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-[28px] bg-surface-solid shadow-[var(--shadow-lg)] sm:rounded-[28px]">
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <p className="text-[1.15rem] font-extrabold leading-tight">
                {ICON[gap.type]} {title}
              </p>
              <p className="num text-[12px] text-text-muted">{range}</p>
            </div>
            <button onClick={onClose} className="btn btn-quiet btn-xs shrink-0">
              {t('common.close')}
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
            {/* Budget et besoins */}
            <div className="space-y-3 rounded-2xl bg-surface-2 p-3.5">
              <div className="grid grid-cols-[1fr_5.5rem_4.5rem] gap-2">
                <label>
                  <span className="label">{gap.type === 'nostay' ? t('gap.budgetNight') : t('gap.budget')}</span>
                  <input className="field num" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder={t('gap.optional')} />
                </label>
                <label>
                  <span className="label">{t('expenses.currency')}</span>
                  <input className="field uppercase" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
                </label>
                <label>
                  <span className="label">{t('gap.people')}</span>
                  <input className="field num" type="number" min={1} max={12} value={travelers} onChange={(e) => setTravelers(Math.max(1, Number(e.target.value) || 1))} />
                </label>
              </div>
              <div>
                <span className="label">{t('gap.needs')}</span>
                <div className="nav-scroll -mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1">
                  {CHIPS[gap.type].map((k) => (
                    <button key={k} onClick={() => setNeeds((n) => (n ? `${n}, ${t(k)}` : t(k)))} className="pill shrink-0 text-[12px]">
                      {t(k)}
                    </button>
                  ))}
                </div>
                <textarea className="field" rows={2} value={needs} onChange={(e) => setNeeds(e.target.value)} placeholder={t('gap.needsPh')} />
              </div>
              {running ? (
                <div>
                  <AiGauge job={running} />
                  <p className="mt-2 text-[12px] text-text-muted">{t('gap.running')}</p>
                </div>
              ) : (
                <button onClick={() => void launch()} className="btn btn-accent w-full">
                  ✨ {result ? t('gap.again') : t('gap.launch')}
                </button>
              )}
            </div>

            {(error || failed) && <p className="notice notice-bad">{error ?? failed?.error}</p>}

            {/* Resultats */}
            {result && (
              <div className="space-y-3">
                <p className="text-[13.5px] leading-snug text-text-soft">{result.summary}</p>
                <p className="text-[11.5px] text-text-muted">ℹ️ {t('gap.verify')}</p>
                <ul className="space-y-3">
                  {result.options.map((o, i) => (
                    <li key={i} className="rounded-[22px] border border-line bg-surface p-4 shadow-[var(--shadow-sm)]">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[15.5px] font-extrabold leading-snug">{o.title}</p>
                          {o.area && <p className="text-[12.5px] text-text-muted">{o.area}</p>}
                        </div>
                        {o.price_text && <span className="chip chip-accent num shrink-0">{o.price_text}</span>}
                      </div>
                      <p className="mt-2 text-[13.5px] leading-snug">{o.why}</p>
                      {o.detail && <p className="mt-1 text-[12.5px] text-text-muted">{o.detail}</p>}
                      {(o.pros?.length > 0 || o.cons?.length > 0) && (
                        <ul className="mt-2 space-y-0.5 text-[12.5px]">
                          {o.pros.map((p) => <li key={p}>👍 {p}</li>)}
                          {o.cons.map((p) => <li key={p} className="text-text-muted">⚠️ {p}</li>)}
                        </ul>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button onClick={() => void apply(o, i)} disabled={busy !== null || applied.has(i)} className={`btn btn-xs ${applied.has(i) ? '' : 'btn-accent'}`}>
                          {applied.has(i) ? `✅ ${t('gap.added')}` : busy === i ? t('common.wait') : `＋ ${t('gap.add')}`}
                        </button>
                        {o.url && (
                          <a href={o.url} target="_blank" rel="noreferrer" className="btn btn-xs">
                            🔗 {t('gap.open')}
                          </a>
                        )}
                        {o.lat != null && o.lng != null && (
                          <a href={`https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lng}`} target="_blank" rel="noreferrer" className="btn btn-xs btn-quiet">
                            📍
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </Portal>
  )
}
