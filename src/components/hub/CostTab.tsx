import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePlaces } from '../../context/PlacesContext'
import { errorMessage } from '../../lib/errors'
import { supabase } from '../../lib/supabase'
import { addDaysIso, shortDate, todayIso } from '../../lib/tripDates'
import type { Expense, Trip } from '../../lib/types'
import type { TripHub } from '../../lib/useTripHub'
import { useI18n } from '../../i18n/I18nContext'

const PALETTE = ['#e2522c', '#ffb020', '#3f8fa3', '#9a6ea8', '#4f7a5e', '#c4653d', '#7f8f7a', '#b1552c']

/** Jour local (AAAA-MM-JJ) d'une date ISO. */
const dayOf = (iso: string) => {
  const d = new Date(iso)
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

/** Courbe lissee a partir de points : un petit arrondi entre chaque point. */
function smoothPath(pts: [number, number][]): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]
    const [x1, y1] = pts[i]
    const mx = (x0 + x1) / 2
    d += ` C${mx},${y0} ${mx},${y1} ${x1},${y1}`
  }
  return d
}

/**
 * « Cout du voyage » : tout ce qui a ete depense sur ce voyage, par vous
 * deux. Recapitulatif du jour, de la semaine et du mois, courbe jour par
 * jour (ou cumulee), classement des postes (le plus, le moins), et un budget
 * facultatif avec ce qu'il reste.
 */
export default function CostTab({ trip, hub }: { trip: Trip; hub: TripHub }) {
  const { t, locale } = useI18n()
  const { editTrip } = usePlaces()
  const [rows, setRows] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cur, setCur] = useState<string | null>(null)
  const [mode, setMode] = useState<'day' | 'cumul'>('day')
  const [picked, setPicked] = useState<number | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [editBudget, setEditBudget] = useState(false)
  const [budgetInput, setBudgetInput] = useState('')
  const [budgetCur, setBudgetCur] = useState(trip.budget_currency ?? 'EUR')
  const svgRef = useRef<SVGSVGElement>(null)

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.from('expenses').select('*').eq('trip_id', trip.id).order('spent_at', { ascending: true })
    if (err) setError(errorMessage(err))
    else setRows((data ?? []) as Expense[])
    setLoading(false)
  }, [trip.id])

  useEffect(() => {
    void load()
    const ch = supabase
      .channel(`cost-${trip.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: `trip_id=eq.${trip.id}` }, () => void load())
      .subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [load, trip.id])

  // Devise affichee : celle du budget si on y a depense, sinon la plus utilisee
  const currencies = useMemo(() => {
    const n = new Map<string, number>()
    for (const r of rows) n.set(r.currency, (n.get(r.currency) ?? 0) + 1)
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)
  }, [rows])
  const currency = cur && currencies.includes(cur) ? cur : currencies.includes(trip.budget_currency ?? '') ? trip.budget_currency! : (currencies[0] ?? trip.budget_currency ?? 'EUR')
  const data = useMemo(() => rows.filter((r) => r.currency === currency), [rows, currency])

  const money = (v: number, code = currency, compact = false) => {
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency: code, maximumFractionDigits: compact || v >= 1000 ? 0 : 2 }).format(v)
    } catch {
      return `${v.toFixed(2)} ${code}`
    }
  }

  const today = todayIso()
  const stats = useMemo(() => {
    const byDay = new Map<string, number>()
    for (const r of data) byDay.set(dayOf(r.spent_at), (byDay.get(dayOf(r.spent_at)) ?? 0) + r.amount)
    const total = data.reduce((n, r) => n + r.amount, 0)
    const now = new Date()
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() || 7) - 1))
    const weekStart = dayOf(monday.toISOString())
    const monthStart = `${today.slice(0, 7)}-01`
    const sumFrom = (from: string) => [...byDay.entries()].filter(([d]) => d >= from && d <= today).reduce((n, [, v]) => n + v, 0)

    // Jours de la courbe : du premier jour de depense (ou du depart) a aujourd'hui / dernier jour
    const first = [...byDay.keys()].sort()[0]
    const last = [...byDay.keys()].sort().slice(-1)[0]
    const from = first ? (trip.start_date && trip.start_date < first && trip.start_date <= today ? trip.start_date : first) : today
    const to = last && last > today ? last : today
    const days: string[] = []
    for (let d = from; d <= to && days.length < 150; d = addDaysIso(d, 1)) days.push(d)
    const daily = days.map((d) => byDay.get(d) ?? 0)
    let acc = 0
    const cumul = daily.map((v) => (acc += v))

    const cats = new Map<string, number>()
    for (const r of data) {
      const k = (r.category ?? '').trim() || t('cost.other')
      const key = k.charAt(0).toUpperCase() + k.slice(1)
      cats.set(key, (cats.get(key) ?? 0) + r.amount)
    }
    const ranking = [...cats.entries()].sort((a, b) => b[1] - a[1])

    const people = new Map<string, number>()
    for (const r of data) people.set(r.user_id, (people.get(r.user_id) ?? 0) + r.amount)

    const spendDays = days.filter((d) => d <= today).length || 1
    return {
      total, today: byDay.get(today) ?? 0, week: sumFrom(weekStart), month: sumFrom(monthStart),
      days, daily, cumul, ranking, people, avg: total / spendDays,
    }
  }, [data, today, trip.start_date, t])

  const budget = trip.budget ?? null
  const budgetHere = budget !== null && (trip.budget_currency ?? 'EUR') === currency
  const left = budgetHere ? (budget as number) - stats.total : null
  const pct = budgetHere && budget ? Math.min(100, (stats.total / (budget as number)) * 100) : 0
  const daysLeft = trip.end_date && trip.end_date > today ? Math.max(1, Math.round((new Date(trip.end_date).getTime() - new Date(today).getTime()) / 86400000)) : 0

  async function saveBudget() {
    const v = budgetInput.trim() === '' ? null : Number(budgetInput.replace(',', '.'))
    if (v !== null && (!Number.isFinite(v) || v < 0)) return
    try {
      await editTrip(trip.id, { budget: v, budget_currency: budgetCur.trim().toUpperCase() || 'EUR' })
      setEditBudget(false)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  // ---- courbe
  const series = mode === 'day' ? stats.daily : stats.cumul
  const W = 320
  const H = 150
  const pad = { l: 8, r: 8, t: 14, b: 22 }
  const maxV = Math.max(1, ...series, mode === 'cumul' && budgetHere ? (budget as number) : 0)
  const x = (i: number) => pad.l + (series.length <= 1 ? (W - pad.l - pad.r) / 2 : (i / (series.length - 1)) * (W - pad.l - pad.r))
  const y = (v: number) => pad.t + (1 - v / maxV) * (H - pad.t - pad.b)
  const pts = series.map((v, i) => [x(i), y(v)] as [number, number])
  const line = smoothPath(pts)
  const area = pts.length > 1 ? `${line} L${pts[pts.length - 1][0]},${H - pad.b} L${pts[0][0]},${H - pad.b} Z` : ''

  function pick(e: React.PointerEvent) {
    const svg = svgRef.current
    if (!svg || series.length === 0) return
    const r = svg.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (series.length - 1))
    setPicked(Math.min(series.length - 1, Math.max(0, i)))
  }

  async function removeExpense(id: string) {
    if (confirmId !== id) {
      setConfirmId(id)
      return
    }
    const { error: err } = await supabase.from('expenses').delete().eq('id', id)
    setConfirmId(null)
    if (err) setError(errorMessage(err))
    else setRows((prev) => prev.filter((r) => r.id !== id))
  }

  const nameOf = (uid: string) => hub.people.find((p) => p.user_id === uid)?.display_name ?? '·'

  if (loading) return <p className="py-10 text-center text-text-muted">{t('common.loading')}</p>

  return (
    <div className="space-y-6">
      {error && <p className="notice notice-bad">{error}</p>}

      {/* Total + budget */}
      <section className="card-feature p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow eyebrow-dot">{t('cost.total')}</p>
            <p className="num mt-2 text-[clamp(2rem,9vw,3rem)] font-extrabold leading-none">{money(stats.total)}</p>
            <p className="num mt-2 text-[13px] text-text-muted">
              {data.length} {t('cost.expenses')} · {t('cost.avg', { v: money(stats.avg) })}
            </p>
          </div>
          <Link to={`/depenses?voyage=${trip.id}`} className="btn btn-accent">
            ＋ {t('cost.add')}
          </Link>
        </div>

        {currencies.length > 1 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {currencies.map((c) => (
              <button key={c} onClick={() => setCur(c)} className={`pill num ${c === currency ? 'pill-active' : ''}`}>
                {c}
              </button>
            ))}
          </div>
        )}

        <div className="mt-5 border-t border-line pt-4">
          {!editBudget && budget === null && (
            <button onClick={() => { setBudgetInput(''); setBudgetCur(trip.budget_currency ?? currency); setEditBudget(true) }} className="btn btn-xs">
              🎯 {t('cost.setBudget')} <span className="text-text-muted">({t('cost.optional')})</span>
            </button>
          )}
          {!editBudget && budget !== null && (
            <div>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[13px] font-bold">
                  🎯 {t('cost.budget')} <span className="num">{money(budget, trip.budget_currency ?? 'EUR')}</span>
                </p>
                <button onClick={() => { setBudgetInput(String(budget)); setBudgetCur(trip.budget_currency ?? 'EUR'); setEditBudget(true) }} className="text-[12px] font-semibold text-accent">
                  {t('common.edit')}
                </button>
              </div>
              {budgetHere ? (
                <>
                  <div className="relative mt-2.5 h-3 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700"
                      style={{ width: `${pct}%`, background: pct >= 100 ? '#b4533f' : pct >= 80 ? '#ffb020' : 'linear-gradient(90deg,#ff7f57,#ffb020)' }}
                    />
                  </div>
                  <p className="num mt-2 text-[13px]">
                    <span className={`font-extrabold ${(left ?? 0) < 0 ? 'text-[#b4533f]' : ''}`}>
                      {(left ?? 0) < 0 ? t('cost.over', { v: money(-(left ?? 0)) }) : t('cost.left', { v: money(left ?? 0) })}
                    </span>
                    <span className="text-text-muted"> · {Math.round(pct)} %</span>
                    {(left ?? 0) > 0 && daysLeft > 0 && <span className="text-text-muted"> · {t('cost.perDay', { v: money((left ?? 0) / daysLeft) })}</span>}
                  </p>
                </>
              ) : (
                <p className="mt-2 text-[12px] text-text-muted">{t('cost.otherCurrency', { c: trip.budget_currency ?? 'EUR' })}</p>
              )}
            </div>
          )}
          {editBudget && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input className="field num flex-1" inputMode="decimal" value={budgetInput} onChange={(e) => setBudgetInput(e.target.value)} placeholder={t('cost.budgetPh')} autoFocus />
                <input className="field w-24 uppercase" maxLength={3} value={budgetCur} onChange={(e) => setBudgetCur(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <button onClick={() => void saveBudget()} className="btn btn-accent btn-xs flex-1">
                  {t('common.save')}
                </button>
                {budget !== null && (
                  <button onClick={() => { setBudgetInput(''); void editTrip(trip.id, { budget: null }).then(() => setEditBudget(false)) }} className="btn btn-xs">
                    {t('cost.removeBudget')}
                  </button>
                )}
                <button onClick={() => setEditBudget(false)} className="btn btn-quiet btn-xs">
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {data.length === 0 ? (
        <p className="rounded-[22px] border border-dashed border-line-strong p-6 text-center text-[14px] leading-relaxed text-text-muted">{t('cost.empty')}</p>
      ) : (
        <>
          {/* Jour / semaine / mois */}
          <section className="grid grid-cols-3 gap-2 sm:gap-3">
            {(
              [
                ['cost.today', stats.today],
                ['cost.week', stats.week],
                ['cost.month', stats.month],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="card p-3.5 sm:p-5">
                <p className="eyebrow">{t(k)}</p>
                <p className="num mt-2 break-words text-[clamp(0.95rem,4vw,1.35rem)] font-extrabold">{money(v)}</p>
              </div>
            ))}
          </section>

          {/* Courbe */}
          <section className="panel p-4 sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[1.1rem] font-extrabold">{t('cost.curve')}</h3>
              <div className="flex gap-1">
                <button onClick={() => { setMode('day'); setPicked(null) }} className={`pill text-[12px] ${mode === 'day' ? 'pill-active' : ''}`}>
                  {t('cost.perDayMode')}
                </button>
                <button onClick={() => { setMode('cumul'); setPicked(null) }} className={`pill text-[12px] ${mode === 'cumul' ? 'pill-active' : ''}`}>
                  {t('cost.cumul')}
                </button>
              </div>
            </div>
            <p className="num mt-2 min-h-5 text-[13px] text-text-muted">
              {picked !== null && stats.days[picked]
                ? `${shortDate(stats.days[picked], locale, true)} · ${money(series[picked])}`
                : t('cost.curveHint')}
            </p>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              className="mt-1 h-auto w-full touch-pan-y select-none"
              onPointerDown={pick}
              onPointerMove={(e) => e.buttons === 1 && pick(e)}
              role="img"
              aria-label={t('cost.curve')}
            >
              <defs>
                <linearGradient id="costFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ff7f57" stopOpacity="0.45" />
                  <stop offset="100%" stopColor="#ff7f57" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[0.25, 0.5, 0.75, 1].map((f) => (
                <line key={f} x1={pad.l} x2={W - pad.r} y1={y(maxV * f)} y2={y(maxV * f)} stroke="currentColor" strokeOpacity="0.1" />
              ))}
              {mode === 'cumul' && budgetHere && (
                <g>
                  <line x1={pad.l} x2={W - pad.r} y1={y(budget as number)} y2={y(budget as number)} stroke="#b4533f" strokeDasharray="4 4" strokeWidth="1.4" />
                  <text x={W - pad.r} y={y(budget as number) - 4} textAnchor="end" fontSize="9" fill="#b4533f">
                    {t('cost.budget')}
                  </text>
                </g>
              )}
              {area && <path d={area} fill="url(#costFill)" />}
              <path d={line} fill="none" stroke="#e2522c" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              {series.length <= 40 && pts.map(([px, py], i) => <circle key={i} cx={px} cy={py} r={picked === i ? 4.5 : 2.2} fill="#e2522c" />)}
              {picked !== null && pts[picked] && <line x1={pts[picked][0]} x2={pts[picked][0]} y1={pad.t} y2={H - pad.b} stroke="#e2522c" strokeOpacity="0.35" />}
              <text x={pad.l} y={H - 6} fontSize="9" fill="currentColor" fillOpacity="0.55">
                {stats.days[0] ? shortDate(stats.days[0], locale) : ''}
              </text>
              <text x={W - pad.r} y={H - 6} textAnchor="end" fontSize="9" fill="currentColor" fillOpacity="0.55">
                {stats.days.length ? shortDate(stats.days[stats.days.length - 1], locale) : ''}
              </text>
              <text x={pad.l} y={pad.t - 3} fontSize="9" fill="currentColor" fillOpacity="0.55">
                {money(maxV, currency, true)}
              </text>
            </svg>
          </section>

          {/* Ou part l'argent : le plus, le moins */}
          <section className="panel p-4 sm:p-6">
            <h3 className="text-[1.1rem] font-extrabold">{t('cost.where')}</h3>
            {stats.ranking.length > 1 && (
              <p className="mt-1 text-[12.5px] text-text-muted">
                🔺 {t('cost.most')} <b className="text-text">{stats.ranking[0][0]}</b> · 🔻 {t('cost.least')} <b className="text-text">{stats.ranking[stats.ranking.length - 1][0]}</b>
              </p>
            )}
            <ul className="mt-4 space-y-3">
              {stats.ranking.map(([cat, v], i) => (
                <li key={cat}>
                  <div className="flex items-baseline justify-between gap-2 text-[13.5px]">
                    <span className="min-w-0 truncate font-semibold">
                      <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-baseline" style={{ background: PALETTE[i % PALETTE.length] }} />
                      {cat}
                    </span>
                    <span className="num shrink-0 font-bold">
                      {money(v)} <span className="font-normal text-text-muted">{Math.round((v / stats.total) * 100)} %</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${(v / stats.ranking[0][1]) * 100}%`, background: PALETTE[i % PALETTE.length] }} />
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* Qui a paye */}
          {stats.people.size > 1 && (
            <section className="panel p-4 sm:p-6">
              <h3 className="text-[1.1rem] font-extrabold">{t('cost.who')}</h3>
              <ul className="mt-3 space-y-2">
                {[...stats.people.entries()].sort((a, b) => b[1] - a[1]).map(([uid, v]) => (
                  <li key={uid} className="flex items-baseline justify-between text-[14px]">
                    <span className="font-semibold">{nameOf(uid)}</span>
                    <span className="num font-bold">{money(v)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Dernieres depenses */}
          <section>
            <h3 className="mb-3 text-[1.1rem] font-extrabold">{t('cost.latest')}</h3>
            <ul className="overflow-hidden rounded-[22px] border border-line bg-surface">
              {[...data].reverse().slice(0, 15).map((r) => (
                <li key={r.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold">{r.merchant}</span>
                    <span className="block truncate text-[11.5px] text-text-muted">
                      {shortDate(dayOf(r.spent_at), locale)}
                      {r.category ? ` · ${r.category}` : ''}
                      {stats.people.size > 1 ? ` · ${nameOf(r.user_id)}` : ''}
                    </span>
                  </span>
                  <span className="num shrink-0 text-[14px] font-bold">{money(r.amount, r.currency)}</span>
                  <button
                    onClick={() => void removeExpense(r.id)}
                    className={`btn btn-xs shrink-0 ${confirmId === r.id ? 'btn-accent' : 'btn-quiet'}`}
                    aria-label={t('common.delete')}
                  >
                    {confirmId === r.id ? t('common.confirm') : '×'}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
