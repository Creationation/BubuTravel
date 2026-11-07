import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePlaces } from '../context/PlacesContext'
import { GeoError, currentPosition } from '../lib/geolocation'
import { haversineKm } from '../lib/stats'
import { fetchStops } from '../lib/tripApi'
import type { TrackPoint, TripStop } from '../lib/types'
import { fmtNum } from '../i18n/current'
import { useI18n } from '../i18n/I18nContext'
import MapCanvas from './MapCanvas'
import Portal from './Portal'

export type RoutePoint = { lat: number; lng: number; name: string }
type Mode = 'car' | 'foot' | 'bike'

type Computed = { points: TrackPoint[]; km: number; minutes: number; approx: boolean }

const PROFILE: Record<Mode, string> = { car: 'routed-car', foot: 'routed-foot', bike: 'routed-bike' }
const SPEED_KMH: Record<Mode, number> = { car: 38, foot: 4.8, bike: 15 }

/** Itineraire routier (OpenStreetMap). Si le service ne repond pas : ligne droite. */
async function computeRoute(a: RoutePoint, b: RoutePoint, mode: Mode, signal: AbortSignal): Promise<Computed> {
  try {
    const url = `https://routing.openstreetmap.de/${PROFILE[mode]}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`
    const res = await fetch(url, { signal })
    if (!res.ok) throw new Error(String(res.status))
    const data = (await res.json()) as { routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[] }
    const r = data.routes?.[0]
    if (!r) throw new Error('no route')
    return {
      points: r.geometry.coordinates.map(([lng, lat], i) => ({ t: i, lat, lng })),
      km: r.distance / 1000,
      minutes: Math.round(r.duration / 60),
      approx: false,
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    const km = haversineKm(a, b)
    return {
      points: [{ t: 0, lat: a.lat, lng: a.lng }, { t: 1, lat: b.lat, lng: b.lng }],
      km,
      minutes: Math.round((km * 1.3 / SPEED_KMH[mode]) * 60),
      approx: true,
    }
  }
}

const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`)

/**
 * Itineraire de A a B sur NOTRE carte : on choisit le depart (sa position,
 * un hebergement, une etape ou un autre lieu), le mode (voiture / scooter,
 * a pied, velo), et le trajet se dessine avec sa distance et sa duree.
 */
export default function RouteSheet({
  to,
  tripId,
  from: initialFrom,
  onClose,
}: {
  to: RoutePoint
  tripId: string | null
  from?: RoutePoint | null
  onClose: () => void
}) {
  const { t } = useI18n()
  const { places } = usePlaces()
  const [stops, setStops] = useState<TripStop[]>([])
  const [fromId, setFromId] = useState<string>(initialFrom ? 'given' : 'me')
  const [me, setMe] = useState<RoutePoint | null>(null)
  const [meError, setMeError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('car')
  const [result, setResult] = useState<Computed | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  useEffect(() => {
    if (tripId) void fetchStops(tripId).then(setStops).catch(() => undefined)
  }, [tripId])

  // Ma position : demandee seulement si on la choisit
  const locate = useCallback(async () => {
    setMeError(null)
    try {
      const fix = await currentPosition()
      setMe({ lat: fix.lat, lng: fix.lng, name: t('route.me') })
    } catch (err) {
      setMeError(err instanceof GeoError ? t(err.key) : t('route.noGps'))
    }
  }, [t])

  useEffect(() => {
    if (fromId === 'me' && !me) void locate()
  }, [fromId, me, locate])

  const options = useMemo(() => {
    const out: { id: string; label: string; group: string; point: RoutePoint }[] = []
    if (initialFrom) out.push({ id: 'given', label: initialFrom.name, group: t('route.groupFrom'), point: initialFrom })
    for (const s of stops) {
      if (s.lat == null || s.lng == null) continue
      if (s.stay_name) out.push({ id: `stay:${s.id}`, label: `🏨 ${s.stay_name} (${s.name})`, group: t('route.groupStays'), point: { lat: s.lat, lng: s.lng, name: s.stay_name } })
    }
    for (const s of stops) if (s.lat != null && s.lng != null) out.push({ id: `stop:${s.id}`, label: s.name, group: t('route.groupStops'), point: { lat: s.lat, lng: s.lng, name: s.name } })
    const near = places
      .filter((p) => (!tripId || p.trip_id === tripId) && Math.abs(p.lat - to.lat) < 0.6 && Math.abs(p.lng - to.lng) < 0.6)
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 60)
    for (const p of near) out.push({ id: `place:${p.id}`, label: p.name, group: t('route.groupPlaces'), point: { lat: p.lat, lng: p.lng, name: p.name } })
    return out
  }, [stops, places, tripId, initialFrom, to.lat, to.lng, t])

  const from: RoutePoint | null = fromId === 'me' ? me : (options.find((o) => o.id === fromId)?.point ?? null)

  useEffect(() => {
    if (!from) {
      setResult(null)
      return
    }
    const ctrl = new AbortController()
    setBusy(true)
    computeRoute(from, to, mode, ctrl.signal)
      .then((r) => {
        setResult(r)
        setBusy(false)
      })
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') setBusy(false)
      })
    return () => ctrl.abort()
  }, [from?.lat, from?.lng, to.lat, to.lng, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const googleUrl = from
    ? `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=${mode === 'car' ? 'driving' : mode === 'foot' ? 'walking' : 'bicycling'}`
    : `https://www.google.com/maps/dir/?api=1&destination=${to.lat},${to.lng}`

  const groups = [...new Set(options.map((o) => o.group))]
  const fit = (result?.points.length ? result.points : []).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 40)) === 0).map((p) => ({ lat: p.lat, lng: p.lng }))
  const pins = [
    ...(from ? [{ id: 'a', lat: from.lat, lng: from.lng, name: from.name, country: '' }] : []),
    { id: 'b', lat: to.lat, lng: to.lng, name: to.name, country: '' },
  ]

  return (
    <Portal>
      <div className="fixed inset-0 z-[2800] flex flex-col bg-bg" role="dialog" aria-modal="true">
        <div className="flex items-center gap-3 border-b border-line bg-surface-solid px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
          <button onClick={onClose} className="btn btn-icon btn-quiet" aria-label={t('common.back')}>
            ←
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-extrabold">🧭 {t('dir.title')}</p>
            <p className="truncate text-[12px] text-text-muted">→ {to.name}</p>
          </div>
        </div>

        <div className="space-y-2.5 border-b border-line bg-surface-solid px-4 py-3">
          <label className="block">
            <span className="label">{t('route.from')}</span>
            <select className="field" value={fromId} onChange={(e) => setFromId(e.target.value)}>
              <option value="me">📍 {t('route.me')}</option>
              {groups.map((g) => (
                <optgroup key={g} label={g}>
                  {options.filter((o) => o.group === g).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={t('route.mode')}>
            {(
              [
                ['car', '🛵', 'route.car'],
                ['foot', '🚶', 'route.foot'],
                ['bike', '🚲', 'route.bike'],
              ] as const
            ).map(([m, icon, key]) => (
              <button
                key={m}
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={`rounded-xl border px-2 py-2 text-[12.5px] font-bold transition-all active:scale-95 ${mode === m ? 'border-accent bg-[var(--halo)]' : 'border-line text-text-muted'}`}
              >
                {icon} {t(key)}
              </button>
            ))}
          </div>
          {meError && fromId === 'me' && <p className="text-[12px] text-[#b4533f]">{meError}</p>}
        </div>

        <div className="relative min-h-0 flex-1">
          <MapCanvas
            key={`${from?.lat ?? 'x'}:${from?.lng ?? 'x'}:${mode}:${result?.points.length ?? 0}`}
            points={pins}
            tracks={result ? [{ id: 'route', name: to.name, points: result.points }] : []}
            autoFit={fit.length > 0 || pins.length > 0}
            fitTo={fit.length > 0 ? fit : pins}
            cluster={false}
          />
          {busy && (
            <span className="absolute left-1/2 top-3 z-[1000] -translate-x-1/2 rounded-full bg-surface-solid px-3.5 py-1.5 text-[12.5px] font-bold shadow">
              <span className="ai-spin inline-block">🧭</span> {t('route.computing')}
            </span>
          )}
        </div>

        <div className="border-t border-line bg-surface-solid px-4 py-3.5 pb-[calc(0.9rem+env(safe-area-inset-bottom))]">
          {result && from ? (
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="num text-[1.5rem] font-extrabold leading-none">{fmtMin(result.minutes)}</p>
                <p className="num mt-1 text-[13px] text-text-muted">
                  {fmtNum(result.km, result.km < 10 ? 1 : 0)} km{result.approx ? ` · ${t('route.approx')}` : ''}
                </p>
              </div>
              <a href={googleUrl} target="_blank" rel="noreferrer" className="btn btn-accent shrink-0">
                ▶ {t('route.go')}
              </a>
            </div>
          ) : (
            <p className="text-[13px] text-text-muted">{fromId === 'me' ? t('route.waitGps') : t('route.pick')}</p>
          )}
        </div>
      </div>
    </Portal>
  )
}
