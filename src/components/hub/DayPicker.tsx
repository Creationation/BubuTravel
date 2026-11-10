import { useMemo, useState } from 'react'
import { usePlaces } from '../../context/PlacesContext'
import { useScope } from '../../context/TripScope'
import { errorMessage } from '../../lib/errors'
import type { Gap } from '../../lib/gaps'
import { isStay, stopOnDay } from '../../lib/schedule'
import { haversineKm } from '../../lib/stats'
import { shortDate } from '../../lib/tripDates'
import { pickDetails, placeName } from '../../lib/discover'
import type { Place, Trip } from '../../lib/types'
import type { TripHub } from '../../lib/useTripHub'
import { useI18n } from '../../i18n/I18nContext'
import { useFeedback } from '../../context/FeedbackContext'
import Portal from '../Portal'
import PlaceSheet from '../PlaceSheet'
import { ActivityDialog } from './AgendaEditors'
import { GapSearch } from './GapsPanel'

const photoOf = (p: Place) => p.image_url || p.gallery?.[0] || p.details?.images?.[0] || null
const kmText = (km: number) => (km < 10 ? km.toFixed(1) : String(Math.round(km)))

/**
 * Ajouter quelque chose a un jour : les idees deja generees (les plus proches
 * d'abord, ouvertes d'un toucher), de nouvelles idees de l'IA autour de la
 * ville, ou une activite creee a la main.
 */
export default function DayPicker({ trip, hub, day, onFree, onClose }: { trip: Trip; hub: TripHub; day: string; onFree: (day: string) => void; onClose: () => void }) {
  const { t, locale } = useI18n()
  const { places: allPlaces } = usePlaces()
  const scope = useScope()
  const [view, setView] = useState<string | null>(null)
  const [gap, setGap] = useState<Gap | null>(null)
  const [manual, setManual] = useState(false)
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

  const near = origin ? list.filter((x) => (x.km ?? 0) <= 60) : list
  const shown = (all ? list : near).slice(0, all ? 80 : 20)
  const viewed = view ? allPlaces.find((p) => p.id === view) ?? null : null

  const gapFor = (): Gap =>
    stop
      ? { id: `empty:${stop.id}:${day}`, type: 'empty', from: day, to: day, days: 1, stopId: stop.id, city: stop.name, country: stop.country, lat: stop.lat, lng: stop.lng }
      : { id: `nostop:${day}`, type: 'nostop', from: day, to: day, days: 1 }

  return (
    <Portal>
      <div className="fixed inset-0 z-[2650] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
        <div className="absolute inset-0 bg-[#120d09]/60" onClick={onClose} />
        <div className="sheet-in relative flex h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] bg-surface-solid shadow-[var(--shadow-lg)] sm:h-[85dvh] sm:rounded-[28px]">
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

          <div className="grid grid-cols-2 gap-2 border-b border-line px-5 py-3">
            <button onClick={() => setGap(gapFor())} className="btn btn-accent btn-xs">
              ✨ {stop ? t('pick.suggestShort') : t('pick.where')}
            </button>
            <button onClick={() => setManual(true)} className="btn btn-xs">
              ✏️ {t('pick.create')}
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
            <p className="mb-2.5 text-[13px] font-extrabold uppercase tracking-[0.08em] text-text-muted">
              💾 {t('pick.mine')} ({shown.length})
            </p>
            {shown.length === 0 ? (
              <p className="rounded-2xl bg-surface-2 px-4 py-3 text-[13px] text-text-muted">{t('pick.none')}</p>
            ) : (
              <ul className="space-y-2.5">
                {shown.map(({ p, km }) => {
                  const d = pickDetails(p.details)
                  const img = photoOf(p)
                  return (
                    <li key={p.id}>
                      <button onClick={() => setView(p.id)} className="flex w-full items-stretch gap-3 overflow-hidden rounded-[20px] border border-line bg-surface text-left shadow-[var(--shadow-sm)] active:scale-[0.98]">
                        <span className="flex h-[92px] w-[92px] shrink-0 items-center justify-center bg-[var(--halo)] text-3xl">
                          {img ? <img src={img} alt="" loading="lazy" className="h-full w-full object-cover" /> : '📍'}
                        </span>
                        <span className="min-w-0 flex-1 py-2.5 pr-3">
                          <span className="block text-[14.5px] font-extrabold leading-snug">{placeName(p)}</span>
                          <span className="num block truncate text-[12px] text-text-muted">
                            {[d?.kind, p.city, km != null ? t('pick.km', { n: kmText(km) }) : null].filter(Boolean).join(' · ')}
                          </span>
                          {d?.summary && <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug text-text-soft">{d.summary}</span>}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {!all && list.length > near.length && (
              <button onClick={() => setAll(true)} className="mt-3 text-[12.5px] font-semibold text-accent">
                {t('pick.showAll', { n: list.length })}
              </button>
            )}

            <button
              onClick={() => {
                onFree(day)
                onClose()
              }}
              className="btn btn-quiet mt-5 w-full"
            >
              😌 {t('pick.free')}
            </button>
          </div>
        </div>
      </div>
      {viewed && <IdeaView place={viewed} day={day} trip={trip} hub={hub} origin={origin} onClose={() => setView(null)} onAdded={(again) => { setView(null); if (!again) onClose() }} />}
      {gap && <GapSearch trip={trip} hub={hub} gap={gap} autoLaunch onClose={() => setGap(null)} />}
      {manual && <ActivityDialog trip={trip} hub={hub} day={day} onClose={() => { setManual(false); onClose() }} />}
    </Portal>
  )
}

/** Une idee en grand : photo, resume, adresse, et trois choix (ajouter au jour, autre idee autour, fiche complete). */
function IdeaView({ place, day, trip, hub, origin, onClose, onAdded }: { place: Place; day: string; trip: Trip; hub: TripHub; origin: { lat: number; lng: number } | null; onClose: () => void; onAdded: (again: boolean) => void }) {
  const { t, locale } = useI18n()
  const { edit } = usePlaces()
  const fb = useFeedback()
  const [time, setTime] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [gap, setGap] = useState<Gap | null>(null)
  const [full, setFull] = useState(false)
  const d = pickDetails(place.details)
  const img = photoOf(place)
  const km = origin ? haversineKm(origin, { lat: place.lat, lng: place.lng }) : null

  async function add() {
    setBusy(true)
    setError(null)
    try {
      await edit(place.id, { visit_date: day, plan_time: time || null })
      await hub.reload()
      const again = await fb.added({ subject: placeName(place), sub: shortDate(day, locale, true) })
      onAdded(again)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  const around: Gap = { id: `empty:near:${place.id}:${day}`, type: 'empty', from: day, to: day, days: 1, stopId: stopOnDay(day, hub.stops)?.id, city: place.city ?? stopOnDay(day, hub.stops)?.name ?? '', country: place.country, lat: place.lat, lng: place.lng }

  return (
    <Portal>
      <div className="fixed inset-0 z-[2680] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
        <div className="absolute inset-0 bg-[#120d09]/60" onClick={onClose} />
        <div className="sheet-in relative flex max-h-[94dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] bg-surface-solid shadow-[var(--shadow-lg)] sm:rounded-[28px]">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {img && <img src={img} alt="" className="h-52 w-full object-cover" />}
            <div className="space-y-3 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[1.3rem] font-extrabold leading-tight">{placeName(place)}</p>
                  <p className="text-[12.5px] text-text-muted">{[d?.kind, place.city, km != null ? t('pick.km', { n: kmText(km) }) : null].filter(Boolean).join(' · ')}</p>
                </div>
                <button onClick={onClose} className="btn btn-quiet btn-xs shrink-0">
                  {t('common.close')}
                </button>
              </div>
              {d?.summary ? <p className="text-[14px] leading-relaxed">{d.summary}</p> : place.notes ? <p className="whitespace-pre-line text-[14px] leading-relaxed">{place.notes}</p> : <p className="text-[13px] text-text-muted">{t('pick.noInfo')}</p>}
              <ul className="space-y-1 text-[13px] text-text-soft">
                {d?.address && <li>📍 {d.address}</li>}
                {d?.duration && <li>⏱️ {d.duration}</li>}
                {d?.price && <li>💶 {d.price}</li>}
                {d?.hours && <li>🕘 {d.hours}</li>}
                {d?.best_time && <li>🌤️ {d.best_time}</li>}
              </ul>
              {d?.tips && d.tips.length > 0 && (
                <ul className="space-y-0.5 text-[12.5px] text-text-muted">
                  {d.tips.slice(0, 3).map((x) => (
                    <li key={x}>💡 {x}</li>
                  ))}
                </ul>
              )}
              {error && <p className="notice notice-bad">{error}</p>}
            </div>
          </div>

          <div className="space-y-2 border-t border-line px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <div className="grid grid-cols-[1fr_auto] items-end gap-2">
              <button onClick={() => void add()} disabled={busy} className="btn btn-accent">
                {busy ? t('common.wait') : `＋ ${t('pick.addTo', { day: shortDate(day, locale, true) })}`}
              </button>
              <label className="block w-28">
                <span className="label">{t('act.time')}</span>
                <input className="field" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setGap(around)} className="btn btn-xs">
                ✨ {t('pick.another')}
              </button>
              <button onClick={() => setFull(true)} className="btn btn-xs">
                📖 {t('pick.full')}
              </button>
            </div>
          </div>
        </div>
      </div>
      {gap && <GapSearch trip={trip} hub={hub} gap={gap} autoLaunch onClose={() => setGap(null)} />}
      {full && <PlaceSheet placeId={place.id} onClose={() => setFull(false)} />}
    </Portal>
  )
}
