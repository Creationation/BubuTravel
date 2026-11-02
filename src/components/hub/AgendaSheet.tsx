import { useEffect, useMemo, useState } from 'react'
import { usePlaces } from '../../context/PlacesContext'
import { isStay } from '../../lib/schedule'
import { addDaysIso, shortDate, todayIso } from '../../lib/tripDates'
import { placeName } from '../../lib/discover'
import type { Trip } from '../../lib/types'
import type { TripHub } from '../../lib/useTripHub'
import { useI18n } from '../../i18n/I18nContext'
import Portal from '../Portal'
import PlaceSheet from '../PlaceSheet'

type Entry = { key: string; time: string; icon: string; title: string; sub?: string; placeId?: string }

/**
 * L'agenda du voyage, jour par jour, directement dans l'app : arrivees,
 * trajets, activites placees, choses a faire. Un bouton l'envoie aussi vers
 * le calendrier du telephone (fichier .ics).
 */
export default function AgendaSheet({
  trip,
  hub,
  onExport,
  onClose,
}: {
  trip: Trip
  hub: TripHub
  onExport: () => void
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  const { places } = usePlaces()
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  const days = useMemo(() => {
    const map = new Map<string, Entry[]>()
    const add = (day: string | null | undefined, e: Entry) => {
      if (!day) return
      map.set(day, [...(map.get(day) ?? []), e])
    }
    for (const s of hub.stops) {
      add(s.arrive_date, { key: `a${s.id}`, time: '00:00', icon: '📍', title: t('agenda.arrive', { name: s.name }), sub: s.stay_name ?? undefined })
      add(s.leave_date, { key: `l${s.id}`, time: '23:00', icon: '🧳', title: t('agenda.leave', { name: s.name }) })
      if (s.transport_departs) {
        const [d, h = '00:00'] = s.transport_departs.split('T')
        add(d, { key: `t${s.id}`, time: h.slice(0, 5), icon: '🚆', title: s.transport_details || t('agenda.transport'), sub: s.transport_ref ?? undefined })
      }
    }
    for (const p of places) {
      if (p.trip_id !== trip.id || !p.visit_date || isStay(p)) continue
      add(p.visit_date, { key: `p${p.id}`, time: p.plan_time ?? '12:00', icon: '🎯', title: placeName(p), sub: p.city ?? undefined, placeId: p.id })
    }
    for (const todo of hub.todos) {
      if (todo.done || !todo.due_at) continue
      add(todo.due_at.slice(0, 10), { key: `d${todo.id}`, time: todo.has_time ? todo.due_at.slice(11, 16) : '08:00', icon: '✅', title: todo.title })
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, items]) => ({ day, items: items.sort((x, y) => x.time.localeCompare(y.time)) }))
  }, [hub.stops, hub.todos, places, trip.id, t])

  const today = todayIso()
  const upcoming = days.findIndex((d) => d.day >= today)

  return (
    <Portal>
      <div className="fixed inset-0 z-[2500] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
        <div className="absolute inset-0 bg-[#120d09]/55" onClick={onClose} />
        <div className="sheet-in relative flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-[28px] bg-surface-solid shadow-[var(--shadow-lg)] sm:rounded-[28px]">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <p className="truncate text-[1.2rem] font-extrabold">📅 {t('agenda.title')}</p>
              <p className="truncate text-[12px] text-text-muted">{trip.title}</p>
            </div>
            <button onClick={onClose} className="btn btn-quiet btn-xs shrink-0">
              {t('common.close')}
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
            {days.length === 0 ? (
              <p className="py-10 text-center text-[14px] text-text-muted">{t('agenda.empty')}</p>
            ) : (
              <ol className="space-y-5">
                {days.map(({ day, items }, i) => (
                  <li key={day} ref={(el) => { if (el && i === Math.max(0, upcoming)) el.scrollIntoView({ block: 'start' }) }}>
                    <p className={`mb-2 text-[13px] font-extrabold capitalize ${day === today ? 'text-accent' : ''}`}>
                      {shortDate(day, locale, true)}
                      {day === today && ` · ${t('ov.today')}`}
                    </p>
                    <ul className="space-y-1.5">
                      {items.map((e) => (
                        <li key={e.key}>
                          <button
                            disabled={!e.placeId}
                            onClick={() => e.placeId && setOpenId(e.placeId)}
                            className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-2.5 text-left disabled:cursor-default"
                          >
                            <span className="num w-11 shrink-0 text-[12px] font-bold text-accent">{e.time === '00:00' || e.time === '23:00' ? '' : e.time}</span>
                            <span className="text-lg">{e.icon}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[14px] font-semibold">{e.title}</span>
                              {e.sub && <span className="block truncate text-[12px] text-text-muted">{e.sub}</span>}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="border-t border-line p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <button onClick={onExport} className="btn btn-accent w-full">
              📲 {t('agenda.export')}
            </button>
            <p className="mt-2 text-center text-[11px] text-text-muted">{t('agenda.exportHint')}</p>
          </div>
        </div>
      </div>
      {openId && <PlaceSheet placeId={openId} onClose={() => setOpenId(null)} />}
    </Portal>
  )
}

/** Debut du voyage : jours sans rien, utile pour savoir ou l'on en est. */
export const dayAfter = addDaysIso
