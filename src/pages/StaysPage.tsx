import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import AppShell from '../components/AppShell'
import RouteSheet from '../components/RouteSheet'
import type { RoutePoint } from '../components/RouteSheet'
import { HostCards } from '../components/hub/HostContacts'
import { PencilIcon } from '../components/hub/icons'
import { usePlaces } from '../context/PlacesContext'
import { flagOf } from '../lib/countries'
import { countryCode, countryName } from '../lib/countryName'
import { errorMessage } from '../lib/errors'
import { supabase } from '../lib/supabase'
import { shortDate } from '../lib/tripDates'
import { fetchDocuments, openDocumentUrl, updateStop } from '../lib/tripApi'
import type { TripDocument, TripStop } from '../lib/types'
import { useI18n } from '../i18n/I18nContext'

const nights = (s: TripStop) =>
  s.arrive_date && s.leave_date ? Math.max(0, Math.round((new Date(s.leave_date).getTime() - new Date(s.arrive_date).getTime()) / 86400000)) : 0

/**
 * Tous les hebergements du ou des voyages, au meme endroit : ou l'on dort,
 * quand, l'adresse, la reservation, le contact de l'hote, et l'itineraire
 * pour y aller. Les etapes sans logement sont signalees a part.
 */
export default function StaysPage() {
  const { t, locale } = useI18n()
  const { trips } = usePlaces()
  const [stops, setStops] = useState<TripStop[]>([])
  const [docs, setDocs] = useState<TripDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tripId, setTripId] = useState<string | null>(null)
  const [country, setCountry] = useState<string | null>(null)
  const [route, setRoute] = useState<{ to: RoutePoint; tripId: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const { data, error: err } = await supabase.from('trip_stops').select('*').order('arrive_date', { ascending: true })
      if (err) throw err
      setStops((data ?? []) as TripStop[])
      const all = await Promise.all(trips.map((tr) => fetchDocuments(tr.id).catch(() => [] as TripDocument[])))
      setDocs(all.flat().filter((d) => d.kind === 'stay'))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [trips])

  useEffect(() => {
    void load()
  }, [load])

  const inTrip = useMemo(() => stops.filter((s) => (tripId ? s.trip_id === tripId : true)), [stops, tripId])
  const countries = useMemo(() => {
    const list: string[] = []
    for (const s of inTrip) if (s.country && !list.some((c) => countryCode(c) === countryCode(s.country))) list.push(s.country)
    return list
  }, [inTrip])
  const shown = useMemo(
    () => inTrip.filter((s) => !country || countryCode(s.country) === countryCode(country)),
    [inTrip, country],
  )
  const hasStay = (s: TripStop) => Boolean(s.stay_name || s.stay_address || (s.hosts ?? []).some((h) => h.stay || h.name))
  const stays = shown.filter(hasStay)
  const missing = shown.filter((s) => !hasStay(s) && nights(s) > 0)
  const totalNights = stays.reduce((n, s) => n + nights(s), 0)

  async function saveHosts(s: TripStop, next: TripStop['hosts']) {
    await updateStop(s.id, { hosts: next })
    setStops((list) => list.map((x) => (x.id === s.id ? { ...x, hosts: next } : x)))
  }

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-3xl px-5 pb-28 sm:px-8">
        <div className="py-8 sm:py-12">
          <p className="eyebrow eyebrow-dot">🏨 {t('stays.eyebrow')}</p>
          <h1 className="display mt-3 text-[clamp(2.2rem,7vw,4rem)]">{t('stays.title')}</h1>
          {!loading && (
            <p className="lede mt-3">
              {t('stays.summary', { n: stays.length, nights: totalNights })}
            </p>
          )}
        </div>

        {trips.length > 1 && (
          <div className="nav-scroll -mx-5 mb-3 flex gap-2 overflow-x-auto px-5 sm:mx-0 sm:px-0">
            <button onClick={() => { setTripId(null); setCountry(null) }} className={`pill shrink-0 ${tripId === null ? 'pill-active' : ''}`}>
              {t('stays.allTrips')}
            </button>
            {trips.map((tr) => (
              <button key={tr.id} onClick={() => { setTripId(tr.id); setCountry(null) }} className={`pill shrink-0 ${tripId === tr.id ? 'pill-active' : ''}`}>
                ✈️ {tr.title}
              </button>
            ))}
          </div>
        )}
        {countries.length > 1 && (
          <div className="nav-scroll -mx-5 mb-5 flex gap-2 overflow-x-auto px-5 sm:mx-0 sm:px-0">
            <button onClick={() => setCountry(null)} className={`pill shrink-0 ${country === null ? 'pill-active' : ''}`}>
              🌏 {t('scope.both')}
            </button>
            {countries.map((c) => (
              <button key={c} onClick={() => setCountry(c)} className={`pill shrink-0 ${country === c ? 'pill-active' : ''}`}>
                {flagOf(c)} {countryName(c)}
              </button>
            ))}
          </div>
        )}

        {error && <p className="notice notice-bad mb-4">{error}</p>}
        {loading && <p className="py-10 text-center text-text-muted">{t('common.loading')}</p>}

        {!loading && stays.length === 0 && (
          <p className="rounded-[22px] border border-dashed border-line-strong p-6 text-center text-[14px] leading-relaxed text-text-muted">{t('stays.empty')}</p>
        )}

        <ul className="space-y-4">
          {stays.map((s) => {
            const tr = trips.find((x) => x.id === s.trip_id)
            const point: RoutePoint | null = s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng, name: s.stay_name || s.name } : null
            const res = docs.filter((d) => d.trip_id === s.trip_id && (d.stop_id === s.id || (d.title ?? '').toLowerCase().includes((s.stay_name ?? '\u0000').toLowerCase())))
            return (
              <li key={s.id} className="rounded-[24px] border border-line bg-surface p-4 shadow-[var(--shadow-sm)]">
                <div className="flex items-start gap-3">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--halo)] text-2xl">🏨</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[1.05rem] font-extrabold leading-snug">{s.stay_name || (s.hosts ?? []).find((h) => h.stay)?.stay || s.name}</p>
                    <p className="text-[13px] text-text-muted">
                      {s.country ? `${flagOf(s.country)} ` : ''}
                      {s.name}
                      {tripId === null && trips.length > 1 && tr ? ` · ${tr.title}` : ''}
                    </p>
                    <p className="num mt-1 text-[13px] font-semibold">
                      {[s.arrive_date, s.leave_date].filter(Boolean).map((d) => shortDate(d!, locale)).join(' → ')}
                      {nights(s) > 0 && <span className="font-normal text-text-muted"> · {t('ov.nights', { n: nights(s) })}</span>}
                    </p>
                  </div>
                  <Link to={`/voyages/${s.trip_id}?onglet=route`} aria-label={t('common.edit')} title={t('common.edit')} className="btn btn-icon btn-quiet shrink-0">
                    <PencilIcon size={16} />
                  </Link>
                </div>

                {s.stay_address && <p className="mt-3 text-[13.5px] text-text-soft">📍 {s.stay_address}</p>}
                {s.stay_ref && <p className="num mt-1 text-[13px] text-text-muted">{t('stop.booking')} {s.stay_ref}</p>}

                <div className="mt-3 flex flex-wrap gap-2">
                  {point && (
                    <button onClick={() => setRoute({ to: point, tripId: s.trip_id })} className="btn btn-accent btn-xs">
                      🧭 {t('dir.title')}
                    </button>
                  )}
                  {point && (
                    <a href={`https://www.google.com/maps/search/?api=1&query=${point.lat},${point.lng}`} target="_blank" rel="noreferrer" className="btn btn-xs">
                      📍 Maps
                    </a>
                  )}
                  {s.stay_url && (
                    <a href={s.stay_url} target="_blank" rel="noreferrer" className="btn btn-xs">
                      🔗 {t('stop.booking')}
                    </a>
                  )}
                  {res.map((d) => (
                    <button
                      key={d.id}
                      onClick={async () => {
                        const w = window.open('', '_blank')
                        const url = await openDocumentUrl(d).catch(() => null)
                        if (url && w) w.location.href = url
                        else w?.close()
                      }}
                      className="btn btn-xs"
                    >
                      📄 {d.title.slice(0, 28)}
                    </button>
                  ))}
                </div>

                <HostCards hosts={s.hosts} onSave={(next) => saveHosts(s, next)} />
              </li>
            )
          })}
        </ul>

        {missing.length > 0 && (
          <section className="mt-8">
            <p className="mb-2.5 text-[13px] font-extrabold uppercase tracking-[0.1em] text-[#b4533f]">⚠️ {t('stays.missing', { n: missing.length })}</p>
            <ul className="space-y-2">
              {missing.map((s) => (
                <li key={s.id}>
                  <Link to={`/voyages/${s.trip_id}?onglet=route`} className="flex items-center gap-3 rounded-2xl border border-dashed border-[#b4533f]/50 bg-surface px-3.5 py-3 active:scale-[0.98]">
                    <span className="text-2xl">🛏️</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-bold">{s.name}</span>
                      <span className="num block text-[12px] text-text-muted">
                        {[s.arrive_date, s.leave_date].filter(Boolean).map((d) => shortDate(d!, locale)).join(' → ')} · {t('ov.nights', { n: nights(s) })}
                      </span>
                    </span>
                    <span className="text-[12px] font-bold text-accent">{t('stays.find')} ›</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      {route && <RouteSheet to={route.to} tripId={route.tripId} onClose={() => setRoute(null)} />}
    </AppShell>
  )
}
