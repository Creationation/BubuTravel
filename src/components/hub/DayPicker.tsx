import { useMemo, useState } from 'react'
import { usePlaces } from '../../context/PlacesContext'
import { useScope } from '../../context/TripScope'
import { errorMessage } from '../../lib/errors'
import type { Gap } from '../../lib/gaps'
import { isStay, stopOnDay } from '../../lib/schedule'
import { haversineKm } from '../../lib/stats'
import { shortDate } from '../../lib/tripDates'
import { placeName } from '../../lib/discover'
import type { Trip } from '../../lib/types'
import type { TripHub } from '../../lib/useTripHub'
import { useI18n } from '../../i18n/I18nContext'
import Portal from '../Portal'
import { GapSearch } from './GapsPanel'

/**
 * « Que voulez-vous faire ce jour-la ? » : un jour sans activite. On choisit
 * parmi les envies deja enregistrees (les plus proches de la ou l'on dort
 * d'abord), ou l'on demande a l'IA des idees autour, ou l'on laisse le jour libre.
 */
export default function DayPicker({ trip, hub, day, onFree, onClose }: { trip: Trip; hub: TripHub; day: string; onFree: (day: string) => void; onClose: () => void }) {
  const { t, locale } = useI18n()
  const { places: allPlaces, edit } = usePlaces()
  const scope = useScope()
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [gap, setGap] = useState<Gap | null>(null)
  const [all, setAll] = useState(false)

  const stop = stopOnDay(day, hub.stops)
  const origin = stop && stop.lat != null && stop.lng != null ? { lat: stop.lat, lng: stop.lng } : null

  const list = useMemo(() => {
    const base = scope
      .places(allPlaces)
      .filter((p) => p.trip_id === trip.id && p.status === 'wishlist' && !p.visit_date && !isStay(p))
      .map((p) => ({ p, km: origin ? haversineKm(origin, { lat: p.lat, lng: p.lng }) : null }))
    return base.sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9))
  }, [allPlaces, scope, trip.id, origin])

  // Avec une etape connue, on ne propose que ce qui est dans la zone (60 km), sauf « tout voir »
  const near = origin ? list.filter((x) => (x.km ?? 0) <= 60) : list
  const shown = (all ? list : near).slice(0, all ? 60 : 12)

  async function addTo(id: string) {
    setBusy(id)
    setError(null)
    try {
      await edit(id, { visit_date: day })
      setAdded((s) => new Set(s).add(id))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const gapFor = (): Gap =>
    stop
      ? { id: `empty:${stop.id}:${day}`, type: 'empty', from: day, to: day, days: 1, stopId: stop.id, city: stop.name, country: stop.country, lat: stop.lat, lng: stop.lng }
      : { id: `nostop:${day}`, type: 'nostop', from: day, to: day, days: 1 }

  return (
    <Portal>
      <div className="fixed inset-0 z-[2650] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
        <div className="absolute inset-0 bg-[#120d09]/60" onClick={onClose} />
        <div className="sheet-in relative flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] bg-surface-solid shadow-[var(--shadow-lg)] sm:rounded-[28px]">
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <p className="text-[1.2rem] font-extrabold leading-tight">💡 {t('pick.title')}</p>
              <p className="text-[12.5px] capitalize text-text-muted">
                {shortDate(day, locale, true)}
                {stop ? ` · ${stop.name}` : ''}
              </p>
            </div>
            <button onClick={onClose} className="btn btn-quiet btn-xs shrink-0">
              {t('common.close')}
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
            <button onClick={() => setGap(gapFor())} className="btn btn-accent w-full">
              ✨ {stop ? t('pick.suggest', { city: stop.name }) : t('pick.where')}
            </button>

            <div>
              <p className="mb-2 text-[13px] font-extrabold uppercase tracking-[0.08em] text-text-muted">💾 {t('pick.mine')}</p>
              {shown.length === 0 ? (
                <p className="rounded-2xl bg-surface-2 px-4 py-3 text-[13px] text-text-muted">{t('pick.none')}</p>
              ) : (
                <ul className="space-y-1.5">
                  {shown.map(({ p, km }) => {
                    const ok = added.has(p.id)
                    return (
                      <li key={p.id} className="flex items-center gap-2.5 rounded-2xl border border-line bg-surface px-3 py-2.5">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-semibold">{placeName(p)}</span>
                          <span className="num block truncate text-[12px] text-text-muted">
                            {[p.city, km != null ? t('pick.km', { n: km < 10 ? km.toFixed(1) : Math.round(km) }) : null].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                        <button
                          onClick={() => void addTo(p.id)}
                          disabled={ok || busy !== null}
                          className={`shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] font-extrabold active:scale-95 ${ok ? 'bg-[rgba(124,135,103,0.2)]' : 'bg-accent text-accent-ink'}`}
                        >
                          {ok ? `✅ ${t('gap.added')}` : busy === p.id ? '…' : `＋ ${t('gap.add')}`}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
              {!all && list.length > near.length && (
                <button onClick={() => setAll(true)} className="mt-2 text-[12.5px] font-semibold text-accent">
                  {t('pick.showAll', { n: list.length })}
                </button>
              )}
            </div>

            {error && <p className="notice notice-bad">{error}</p>}

            <button
              onClick={() => {
                onFree(day)
                onClose()
              }}
              className="btn btn-quiet w-full"
            >
              😌 {t('pick.free')}
            </button>
          </div>
        </div>
      </div>
      {gap && <GapSearch trip={trip} hub={hub} gap={gap} autoLaunch onClose={() => setGap(null)} />}
    </Portal>
  )
}
