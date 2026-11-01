import { useState } from 'react'
import { daysOf, durationOf, fmtMinutes, loadOfDay, stopOf, DAY_LIMIT } from '../../lib/schedule'
import { shortDate } from '../../lib/tripDates'
import type { Place, TripStop } from '../../lib/types'
import { useI18n } from '../../i18n/I18nContext'

/**
 * Programme d'une etape, jour par jour : ce qui est prevu (heure, duree),
 * la charge de la journee, et le nombre de choses de la ville encore a placer.
 */
export default function StopProgramme({
  stop,
  stops,
  places,
  onOpen,
}: {
  stop: TripStop
  stops: TripStop[]
  places: Place[]
  onOpen: (id: string) => void
}) {
  const { t, locale } = useI18n()
  const [open, setOpen] = useState(false)
  const days = daysOf(stop)
  if (days.length === 0) return null

  const here = places.filter((p) => p.status === 'wishlist' && stopOf(p, stops)?.id === stop.id)
  const toPlace = here.filter((p) => !p.visit_date || !days.includes(p.visit_date))
  const planned = days.reduce((n, d) => n + loadOfDay(d, places).items.length, 0)

  return (
    <div className="mt-4 rounded-2xl border border-line bg-surface-2/60">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left">
        <span className="text-[14px] font-bold">{t('plan.programme')}</span>
        <span className="flex items-center gap-1.5">
          {planned > 0 && <span className="chip chip-accent num py-0">{planned}</span>}
          {toPlace.length > 0 && <span className="chip num py-0">{t('plan.toPlace', { n: toPlace.length })}</span>}
          <span className={`text-text-muted transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
        </span>
      </button>
      {open && (
        <ol className="space-y-3 border-t border-line px-3.5 py-3">
          {days.map((d) => {
            const load = loadOfDay(d, places)
            const full = load.minutes > DAY_LIMIT
            return (
              <li key={d}>
                <div className="flex items-baseline justify-between">
                  <p className="text-[13px] font-bold capitalize">{shortDate(d, locale, true)}</p>
                  {load.minutes > 0 && (
                    <span className={`num text-[11px] ${full ? 'font-bold text-[#b4533f]' : 'text-text-muted'}`}>
                      {full ? '🥵 ' : ''}
                      {fmtMinutes(load.minutes)}
                    </span>
                  )}
                </div>
                {load.items.length === 0 ? (
                  <p className="text-[12px] text-text-muted">{t('plan.empty')}</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {load.items.map((p) => (
                      <li key={p.id}>
                        <button onClick={() => onOpen(p.id)} className="flex w-full items-center gap-2 rounded-xl px-1 py-1 text-left hover:bg-surface">
                          <span className="num w-11 shrink-0 text-[12px] font-bold text-accent">{p.plan_time ?? '·'}</span>
                          <span className="min-w-0 flex-1 truncate text-[13px]">{p.name}</span>
                          <span className="num shrink-0 text-[11px] text-text-muted">{fmtMinutes(durationOf(p))}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
