import { useMemo, useState } from 'react'
import { useAiJobs } from '../../context/AiJobsContext'
import { usePlaces } from '../../context/PlacesContext'
import { FAMILIES, emojiOf, familyOf, imageOf, placeName } from '../../lib/discover'
import type { Family } from '../../lib/discover'
import { isStay, photoScore } from '../../lib/schedule'
import { shortDate } from '../../lib/tripDates'
import type { Place, Trip } from '../../lib/types'
import { useI18n } from '../../i18n/I18nContext'
import PlaceSheet from '../PlaceSheet'
import AiGauge from '../AiGauge'
import { useScope } from '../../context/TripScope'

/**
 * « A decouvrir » : TOUT ce qu'on a envie de faire pendant le voyage, range
 * par famille (temples, plages, manger...). Un toucher ouvre la fiche avec
 * photos, infos et « Integrer au voyage ». Le bouton magique place tout ce
 * qui n'a pas encore de jour.
 */
export default function DiscoverSection({ trip }: { trip: Trip }) {
  const { t, locale, lang } = useI18n()
  const { places } = usePlaces()
  const scope = useScope()
  const { queue, activeFor, jobs } = useAiJobs()
  const [family, setFamily] = useState<Family | 'all'>('all')
  const [onlyTodo, setOnlyTodo] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const all = useMemo(
    () => scope.places(places.filter((p) => p.trip_id === trip.id && p.status === 'wishlist' && !isStay(p))),
    [places, trip.id, scope],
  )
  const groups = useMemo(() => {
    const map = new Map<Family, Place[]>()
    for (const p of all) {
      if (onlyTodo && p.visit_date) continue
      const f = familyOf(p)
      map.set(f, [...(map.get(f) ?? []), p])
    }
    for (const list of map.values())
      list.sort((a, b) => Number(Boolean(imageOf(b))) - Number(Boolean(imageOf(a))) || photoScore(b) - photoScore(a))
    return FAMILIES.filter((f) => map.has(f.id)).map((f) => ({ ...f, items: map.get(f.id)! }))
  }, [all, onlyTodo])

  const unplanned = all.filter((p) => !p.visit_date).length
  const arranging = activeFor('arrange_trip', 'trip_id', trip.id) ?? jobs.find((j) => j.kind === 'arrange_trip' && j.trip_id === trip.id && (j.status === 'pending' || j.status === 'processing'))
  const lastArrange = jobs.find((j) => j.kind === 'arrange_trip' && j.trip_id === trip.id && j.status === 'ready')
  const shown = family === 'all' ? groups : groups.filter((g) => g.id === family)

  if (all.length === 0) return null

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[1.35rem] font-extrabold tracking-tight">
          {t('ov.discover')} <span className="num text-[1rem] font-bold text-text-muted">{all.length}</span>
        </h2>
        <button onClick={() => setOnlyTodo((v) => !v)} className={`pill shrink-0 text-[12px] ${onlyTodo ? 'pill-active' : ''}`}>
          {t('disc.toPlace', { n: unplanned })}
        </button>
      </div>

      {/* Le bouton magique */}
      <div className="card-feature mb-4 flex flex-wrap items-center gap-3 p-4">
        <span className="text-3xl">🪄</span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-extrabold">{t('disc.arrange')}</p>
          {arranging && (
            <div className="my-2">
              <AiGauge job={arranging} />
            </div>
          )}
          <p className="text-[12px] leading-snug text-text-muted">
            {arranging ? t('disc.arranging') : lastArrange ? t('disc.arranged', { n: (lastArrange.result as { applied?: number } | null)?.applied ?? 0 }) : t('disc.arrangeHint', { n: unplanned })}
          </p>
        </div>
        <button
          onClick={() => void queue('arrange_trip', { trip_id: trip.id, lang }, trip.id)}
          disabled={Boolean(arranging) || unplanned === 0}
          className="btn btn-accent shrink-0"
        >
          {arranging ? <span className="ai-spin inline-block">✨</span> : '✨'} {t('disc.arrangeGo')}
        </button>
      </div>

      {/* Familles */}
      <div className="nav-scroll -mx-5 mb-4 flex gap-2 overflow-x-auto px-5 sm:-mx-8 sm:px-8">
        <button onClick={() => setFamily('all')} className={`pill shrink-0 ${family === 'all' ? 'pill-active' : ''}`}>
          {t('disc.all')}
        </button>
        {groups.map((g) => (
          <button key={g.id} onClick={() => setFamily(g.id)} className={`pill shrink-0 ${family === g.id ? 'pill-active' : ''}`}>
            {g.emoji} {t(g.label)} <span className="num opacity-60">{g.items.length}</span>
          </button>
        ))}
      </div>

      <div className="space-y-6">
        {shown.map((g) => (
          <div key={g.id}>
            <p className="mb-2 text-[15px] font-extrabold">
              {g.emoji} {t(g.label)}
            </p>
            <div className="nav-scroll -mx-5 flex snap-x gap-3 overflow-x-auto px-5 pb-2 sm:-mx-8 sm:px-8">
              {g.items.map((p) => {
                const img = imageOf(p)
                const filling = activeFor('place_info', 'place_id', p.id)
                return (
                  <button key={p.id} onClick={() => setOpenId(p.id)} className="w-40 shrink-0 snap-start text-left transition-transform active:scale-[0.97] sm:w-48">
                    <div className="relative aspect-[4/5] overflow-hidden rounded-[22px] bg-surface-2 shadow-[var(--shadow-sm)]">
                      {img ? (
                        <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(140deg,#ffb38a,#ff7f57_45%,#c56fd0)] text-5xl">
                          {emojiOf(g.id)}
                        </div>
                      )}
                      <span
                        className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-bold shadow ${
                          p.visit_date ? 'bg-white text-[#2a160d]' : 'bg-black/45 text-white backdrop-blur-md'
                        }`}
                      >
                        {p.visit_date ? `📅 ${shortDate(p.visit_date, locale)}` : t('disc.unplanned')}
                      </span>
                      {filling && (
                        <span className="absolute inset-x-2 bottom-2 rounded-xl bg-surface-solid/95 px-2 py-1.5 shadow">
                          <AiGauge job={filling} compact />
                        </span>
                      )}
                    </div>
                    <p className="mt-2 line-clamp-2 text-[14px] font-bold leading-snug">{placeName(p)}</p>
                    <p className="truncate text-[12px] text-text-muted">{p.details?.kind || p.city}</p>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {openId && <PlaceSheet placeId={openId} onClose={() => setOpenId(null)} />}
    </section>
  )
}
