import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAiJobs } from '../../context/AiJobsContext'
import { usePlaces } from '../../context/PlacesContext'
import { useScope } from '../../context/TripScope'
import { errorMessage } from '../../lib/errors'
import { detectGaps } from '../../lib/gaps'
import type { Gap } from '../../lib/gaps'
import { isStay } from '../../lib/schedule'
import { loadTickets } from '../../lib/tickets'
import { shortDate, todayIso } from '../../lib/tripDates'
import type { Trip } from '../../lib/types'
import type { TripHub } from '../../lib/useTripHub'
import { useI18n } from '../../i18n/I18nContext'
import Portal from '../Portal'
import { GapSearch, applyGapOption } from './GapsPanel'
import type { Result } from './GapsPanel'
import type { HubTab } from './Overview'

type Row = {
  id: string
  ok: boolean
  icon: string
  title: string
  detail?: string
  action?: { label: string; run: () => void }
  gaps?: Gap[]
}

/**
 * « Verifier mon voyage » : repasse sur tout (jours sans etape, logements,
 * trajets, activites, billets, papiers, a faire en retard). Chaque ligne se
 * deplie pour regler les manques un par un, ou tout d'un coup avec les
 * boutons du haut (recherche IA pour tout, puis « tout accepter »).
 */
export default function TripCheck({ trip, hub, go, onClose }: { trip: Trip; hub: TripHub; go: (tab: HubTab) => void; onClose: () => void }) {
  const { t, locale, lang } = useI18n()
  const navigate = useNavigate()
  const { places: allPlaces, add } = usePlaces()
  const { queue, jobs } = useAiJobs()
  const scope = useScope()
  const places = useMemo(() => scope.places(allPlaces).filter((p) => p.trip_id === trip.id), [allPlaces, scope, trip.id])
  const [gap, setGap] = useState<Gap | null>(null)
  const [viewGap, setViewGap] = useState<Gap | null>(null)
  const [openRow, setOpenRow] = useState<string | null>(null)
  const [bulk, setBulk] = useState(false)
  const [tickets, setTickets] = useState<number | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    loadTickets().then((l) => setTickets(l.length)).catch(() => setTickets(0))
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  const scopedTrip = useMemo(() => (scope.range ? { ...trip, start_date: scope.range.from, end_date: scope.range.to } : trip), [trip, scope.range])
  const gaps = useMemo(() => detectGaps(scopedTrip, hub.stops, places, hub.docs), [scopedTrip, hub.stops, places, hub.docs])
  const today = todayIso()
  const unplanned = places.filter((p) => p.status === 'wishlist' && !p.visit_date && !isStay(p))
  const arranging = jobs.some((j) => j.kind === 'arrange_trip' && j.trip_id === trip.id && (j.status === 'pending' || j.status === 'processing'))
  const lateTodos = hub.todos.filter((x) => !x.done && x.due_at && x.due_at.slice(0, 10) < today)
  const hasDoc = (kinds: string[]) => hub.docs.some((d) => kinds.includes(d.kind))
  const range = (g: Gap) => (g.from === g.to ? shortDate(g.from, locale) : `${shortDate(g.from, locale)} → ${shortDate(g.to, locale)}`)

  const gapJob = (g: Gap, status: string[]) =>
    jobs.find((j) => j.kind === 'gap_search' && j.trip_id === trip.id && (j.input?.gap as Gap | undefined)?.id === g.id && status.includes(j.status))
  const gapLabel = (g: Gap) =>
    g.type === 'nostop' ? t('gap.nostop', { n: g.days })
    : g.type === 'nostay' ? t('gap.nostay', { city: g.city ?? '', n: g.days })
    : g.type === 'notransport' ? t('gap.notransport', { a: g.city ?? '', b: g.toCity ?? '' })
    : t('gap.empty', { city: g.city ?? '', n: g.days })

  const searchInput = (g: Gap) => ({
    gap: g, budget: null, currency: trip.budget_currency ?? 'EUR', needs: '', travelers: Math.max(1, hub.people.length || 2), lang,
  })

  /** Recherche IA pour plusieurs trous d'un coup (ou ouvre le trou s'il est seul). */
  async function launchAll(list: Gap[]) {
    if (list.length === 1) {
      setGap(list[0])
      return
    }
    try {
      for (const g of list) if (!gapJob(g, ['pending', 'processing', 'ready'])) await queue('gap_search', searchInput(g), trip.id)
      setOpenRow(null)
      setMsg(t('chk.started'))
    } catch (err) {
      setMsg(errorMessage(err))
    }
  }

  const rows: Row[] = []
  const of = (type: Gap['type']) => gaps.filter((g) => g.type === type)

  const nostop = of('nostop')
  rows.push(
    nostop.length === 0
      ? { id: 'days', ok: true, icon: '🗺️', title: t('chk.days.ok') }
      : { id: 'days', ok: false, icon: '🗺️', title: t('chk.days.ko', { n: nostop.reduce((n, g) => n + g.days, 0) }), detail: nostop.map(range).join(' · '), gaps: nostop, action: { label: t('chk.fix'), run: () => void launchAll(nostop) } },
  )
  const nostay = of('nostay')
  rows.push(
    nostay.length === 0
      ? { id: 'stay', ok: true, icon: '🏨', title: t('chk.stay.ok') }
      : { id: 'stay', ok: false, icon: '🏨', title: t('chk.stay.ko', { n: nostay.length }), detail: nostay.map((g) => `${g.city} (${range(g)})`).join(' · '), gaps: nostay, action: { label: t('chk.fix'), run: () => void launchAll(nostay) } },
  )
  const notr = of('notransport')
  rows.push(
    notr.length === 0
      ? { id: 'tr', ok: true, icon: '✈️', title: t('chk.tr.ok') }
      : { id: 'tr', ok: false, icon: '✈️', title: t('chk.tr.ko', { n: notr.length }), detail: notr.map((g) => `${g.city} → ${g.toCity}`).join(' · '), gaps: notr, action: { label: t('chk.fix'), run: () => void launchAll(notr) } },
  )
  const empty = of('empty')
  rows.push(
    empty.length === 0 && unplanned.length === 0
      ? { id: 'act', ok: true, icon: '🎯', title: t('chk.act.ok') }
      : {
          id: 'act', ok: false, icon: '🎯', gaps: empty,
          title: empty.length ? t('chk.act.ko', { n: empty.reduce((n, g) => n + g.days, 0) }) : t('chk.unplanned', { n: unplanned.length }),
          detail: unplanned.length && empty.length ? t('chk.unplanned', { n: unplanned.length }) : undefined,
          action: unplanned.length
            ? { label: arranging ? t('chk.running') : t('chk.place'), run: () => { if (!arranging) { void queue('arrange_trip', { trip_id: trip.id, lang }, trip.id); setMsg(t('chk.started')) } } }
            : { label: t('chk.fix'), run: () => void launchAll(empty) },
        },
  )
  rows.push(
    tickets === null
      ? { id: 'tk', ok: true, icon: '🎟️', title: t('common.loading') }
      : tickets > 0
        ? { id: 'tk', ok: true, icon: '🎟️', title: t('chk.tk.ok', { n: tickets }) }
        : { id: 'tk', ok: false, icon: '🎟️', title: t('chk.tk.ko'), action: { label: t('chk.add'), run: () => { onClose(); navigate('/coffre') } } },
  )
  rows.push(
    hasDoc(['passport', 'insurance']) || hasDoc(['flight'])
      ? { id: 'doc', ok: true, icon: '🛂', title: t('chk.doc.ok') }
      : { id: 'doc', ok: false, icon: '🛂', title: t('chk.doc.ko'), action: { label: t('chk.add'), run: () => { onClose(); go('docs') } } },
  )
  rows.push(
    lateTodos.length === 0
      ? { id: 'todo', ok: true, icon: '✅', title: t('chk.todo.ok') }
      : { id: 'todo', ok: false, icon: '✅', title: t('chk.todo.ko', { n: lateTodos.length }), action: { label: t('chk.see'), run: () => { onClose(); go('todo') } } },
  )

  const allGaps = rows.flatMap((r) => r.gaps ?? [])
  const readyOnes = allGaps
    .map((g) => ({ g, job: gapJob(g, ['ready']) }))
    .filter((x) => x.job && ((x.job.result as unknown as Result | null)?.options?.length ?? 0) > 0)
  const anyTodo = allGaps.some((g) => !gapJob(g, ['pending', 'processing', 'ready'])) || (unplanned.length > 0 && !arranging)

  async function fixAll() {
    setBulk(true)
    try {
      for (const g of allGaps) if (!gapJob(g, ['pending', 'processing', 'ready'])) await queue('gap_search', searchInput(g), trip.id)
      if (unplanned.length && !arranging) await queue('arrange_trip', { trip_id: trip.id, lang }, trip.id)
      setMsg(t('chk.started'))
    } catch (err) {
      setMsg(errorMessage(err))
    } finally {
      setBulk(false)
    }
  }

  async function acceptAll() {
    setBulk(true)
    let n = 0
    try {
      for (const { g, job } of readyOnes) {
        const o = (job!.result as unknown as Result).options[0]
        await applyGapOption(o, g, { trip, hub, add, queue, t, lang })
        n++
      }
      setMsg(t('chk.accepted', { n }))
    } catch (err) {
      setMsg(errorMessage(err))
    } finally {
      await hub.reload()
      setBulk(false)
    }
  }

  const done = rows.filter((r) => r.ok).length
  const pct = Math.round((done / rows.length) * 100)

  return (
    <Portal>
      <div className="fixed inset-0 z-[2650] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
        <div className="absolute inset-0 bg-[#120d09]/60" onClick={onClose} />
        <div className="sheet-in relative flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] bg-surface-solid shadow-[var(--shadow-lg)] sm:rounded-[28px]">
          <div className="border-b border-line px-5 pb-4 pt-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[1.25rem] font-extrabold">✅ {t('chk.title')}</p>
                <p className="text-[12.5px] text-text-muted">{pct === 100 ? t('chk.allGood') : t('chk.progress', { n: rows.length - done })}</p>
              </div>
              <button onClick={onClose} className="btn btn-quiet btn-xs shrink-0">
                {t('common.close')}
              </button>
            </div>
            <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${pct}%`, background: pct === 100 ? 'var(--color-olive)' : 'linear-gradient(90deg,#ff7f57,#ffb020)' }} />
            </div>
          </div>

          <ul className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain px-5 py-4">
            {(anyTodo || readyOnes.length > 0) && (
              <li className="space-y-2">
                {readyOnes.length > 0 && (
                  <button onClick={() => void acceptAll()} disabled={bulk} className="btn btn-accent w-full">
                    ✅ {bulk ? t('common.wait') : t('chk.acceptAll', { n: readyOnes.length })}
                  </button>
                )}
                {anyTodo && (
                  <button onClick={() => void fixAll()} disabled={bulk} className={`btn w-full ${readyOnes.length > 0 ? '' : 'btn-accent'}`}>
                    ✨ {t('chk.fixAll')}
                  </button>
                )}
              </li>
            )}
            {msg && <li className="rounded-2xl bg-[rgba(124,135,103,0.14)] px-4 py-3 text-[13px] font-semibold">✨ {msg}</li>}
            {rows.map((r) => {
              const multi = !r.ok && (r.gaps?.length ?? 0) > 0
              const expanded = multi && openRow === r.id
              return (
                <li key={r.id} className={`rounded-2xl border ${r.ok ? 'border-line bg-surface' : 'border-[#b4533f]/40 bg-surface'}`}>
                  <div className="flex items-center gap-3 p-3.5">
                    <button type="button" onClick={() => multi && setOpenRow(expanded ? null : r.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <span className="text-2xl">{r.ok ? '✅' : r.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-bold leading-snug">{r.title}</span>
                        {r.detail && !expanded && <span className="block text-[12px] leading-snug text-text-muted">{r.detail}</span>}
                      </span>
                      {multi && <span className="text-text-muted">{expanded ? '▴' : '▾'}</span>}
                    </button>
                    {r.action && (
                      <button onClick={r.action.run} className="shrink-0 rounded-full bg-accent px-3.5 py-2 text-[12.5px] font-extrabold text-accent-ink active:scale-95">
                        ✨ {r.gaps && r.gaps.length > 1 && !r.action.label.includes('…') ? t('chk.fixAllRow') : r.action.label}
                      </button>
                    )}
                  </div>
                  {expanded && (
                    <ul className="fade-in space-y-1.5 border-t border-line px-3.5 py-3">
                      {r.gaps!.map((g) => {
                        const run = gapJob(g, ['pending', 'processing'])
                        const rdy = gapJob(g, ['ready'])
                        return (
                          <li key={g.id} className="flex items-center gap-2.5 rounded-xl bg-surface-2 px-3 py-2.5">
                            <span className="min-w-0 flex-1">
                              <span className="block text-[13px] font-semibold leading-snug">{gapLabel(g)}</span>
                              <span className="num block text-[11.5px] text-text-muted">{range(g)}</span>
                            </span>
                            {run ? (
                              <span className="shrink-0 text-[12px] font-semibold text-text-muted">⏳ {t('chk.running')}</span>
                            ) : rdy ? (
                              <button onClick={() => setViewGap(g)} className="shrink-0 rounded-full bg-[rgba(124,135,103,0.2)] px-3 py-1.5 text-[12px] font-extrabold active:scale-95">
                                👀 {t('chk.view')}
                              </button>
                            ) : (
                              <button onClick={() => setGap(g)} className="shrink-0 rounded-full bg-accent px-3 py-1.5 text-[12px] font-extrabold text-accent-ink active:scale-95">
                                ✨ {t('chk.fix')}
                              </button>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      </div>
      {gap && <GapSearch trip={trip} hub={hub} gap={gap} autoLaunch onClose={() => setGap(null)} />}
      {viewGap && <GapSearch trip={trip} hub={hub} gap={viewGap} onClose={() => setViewGap(null)} />}
    </Portal>
  )
}
