import { useEffect, useMemo, useState } from 'react'
import { useAiJobs } from '../../context/AiJobsContext'
import { usePlaces } from '../../context/PlacesContext'
import { useScope } from '../../context/TripScope'
import { detectGaps } from '../../lib/gaps'
import type { Gap } from '../../lib/gaps'
import { isStay } from '../../lib/schedule'
import { loadTickets } from '../../lib/tickets'
import { shortDate, todayIso } from '../../lib/tripDates'
import type { Trip } from '../../lib/types'
import type { TripHub } from '../../lib/useTripHub'
import { useI18n } from '../../i18n/I18nContext'
import Portal from '../Portal'
import { GapSearch } from './GapsPanel'
import type { HubTab } from './Overview'
import { useNavigate } from 'react-router-dom'

type Row = {
  id: string
  ok: boolean
  icon: string
  title: string
  detail?: string
  action?: { label: string; run: () => void }
}

/**
 * « Verifier mon voyage » : un seul bouton qui repasse sur tout (jours sans
 * etape, logements, trajets, activites, billets, papiers, a faire en retard)
 * et propose, pour chaque manque, UNE action qui le regle d'un toucher.
 */
export default function TripCheck({ trip, hub, go, onClose }: { trip: Trip; hub: TripHub; go: (tab: HubTab) => void; onClose: () => void }) {
  const { t, locale, lang } = useI18n()
  const navigate = useNavigate()
  const { places: allPlaces } = usePlaces()
  const { queue, jobs } = useAiJobs()
  const scope = useScope()
  const places = useMemo(() => scope.places(allPlaces).filter((p) => p.trip_id === trip.id), [allPlaces, scope, trip.id])
  const [gap, setGap] = useState<Gap | null>(null)
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

  const rows: Row[] = []
  const of = (type: Gap['type']) => gaps.filter((g) => g.type === type)

  const nostop = of('nostop')
  rows.push(
    nostop.length === 0
      ? { id: 'days', ok: true, icon: '🗺️', title: t('chk.days.ok') }
      : { id: 'days', ok: false, icon: '🗺️', title: t('chk.days.ko', { n: nostop.reduce((n, g) => n + g.days, 0) }), detail: nostop.map(range).join(' · '), action: { label: t('chk.fix'), run: () => setGap(nostop[0]) } },
  )
  const nostay = of('nostay')
  rows.push(
    nostay.length === 0
      ? { id: 'stay', ok: true, icon: '🏨', title: t('chk.stay.ok') }
      : { id: 'stay', ok: false, icon: '🏨', title: t('chk.stay.ko', { n: nostay.length }), detail: nostay.map((g) => `${g.city} (${range(g)})`).join(' · '), action: { label: t('chk.fix'), run: () => setGap(nostay[0]) } },
  )
  const notr = of('notransport')
  rows.push(
    notr.length === 0
      ? { id: 'tr', ok: true, icon: '✈️', title: t('chk.tr.ok') }
      : { id: 'tr', ok: false, icon: '✈️', title: t('chk.tr.ko', { n: notr.length }), detail: notr.map((g) => `${g.city} → ${g.toCity}`).join(' · '), action: { label: t('chk.fix'), run: () => setGap(notr[0]) } },
  )
  const empty = of('empty')
  rows.push(
    empty.length === 0 && unplanned.length === 0
      ? { id: 'act', ok: true, icon: '🎯', title: t('chk.act.ok') }
      : {
          id: 'act', ok: false, icon: '🎯',
          title: empty.length ? t('chk.act.ko', { n: empty.reduce((n, g) => n + g.days, 0) }) : t('chk.unplanned', { n: unplanned.length }),
          detail: unplanned.length && empty.length ? t('chk.unplanned', { n: unplanned.length }) : undefined,
          action: unplanned.length
            ? { label: arranging ? t('chk.running') : t('chk.place'), run: () => { if (!arranging) { void queue('arrange_trip', { trip_id: trip.id, lang }, trip.id); setMsg(t('chk.started')) } } }
            : { label: t('chk.fix'), run: () => setGap(empty[0]) },
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
            {msg && <li className="rounded-2xl bg-[rgba(124,135,103,0.14)] px-4 py-3 text-[13px] font-semibold">✨ {msg}</li>}
            {rows.map((r) => (
              <li key={r.id} className={`flex items-center gap-3 rounded-2xl border p-3.5 ${r.ok ? 'border-line bg-surface' : 'border-[#b4533f]/40 bg-surface'}`}>
                <span className="text-2xl">{r.ok ? '✅' : r.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-bold leading-snug">{r.title}</span>
                  {r.detail && <span className="block text-[12px] leading-snug text-text-muted">{r.detail}</span>}
                </span>
                {r.action && (
                  <button onClick={r.action.run} className="shrink-0 rounded-full bg-accent px-3.5 py-2 text-[12.5px] font-extrabold text-accent-ink active:scale-95">
                    ✨ {r.action.label}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
      {gap && <GapSearch trip={trip} hub={hub} gap={gap} autoLaunch onClose={() => setGap(null)} />}
    </Portal>
  )
}
