import { Link } from 'react-router-dom'
import Countdown from '../Countdown'
import Reveal from '../Reveal'
import { Avatar } from '../AppShell'
import { flagOf } from '../../lib/countries'
import { formatRange } from '../../lib/stats'
import { photoScore } from '../../lib/schedule'
import type { Place, Trip } from '../../lib/types'
import type { TripHub } from '../../lib/useTripHub'
import { useI18n } from '../../i18n/I18nContext'
import { CalendarIcon, ShareIcon, SparkIcon } from './icons'

/**
 * En-tete du voyage, facon app Apple : mosaique des photos des lieux du
 * voyage en fond (ou la couverture), titre tres grand, compte a rebours en
 * tuiles de verre, infos en pastilles et actions en boutons ronds.
 */
export default function TripHero({
  trip,
  hub,
  cover,
  places,
  totalDays,
  editing,
  onAssistant,
  onCalendar,
  onShare,
  onEdit,
}: {
  trip: Trip
  hub: TripHub
  cover: string | null
  places: Place[]
  totalDays: number | null
  editing: boolean
  onAssistant: () => void
  onCalendar: () => void
  onShare: () => void
  onEdit: () => void
}) {
  const { t, locale } = useI18n()
  const countries = [...new Set(hub.stops.map((s) => s.country).filter(Boolean) as string[])]

  // Jusqu'a 5 photos des lieux du voyage, une par lieu, pour la mosaique
  const photos = cover
    ? [cover]
    : [...places]
        .sort((a, b) => photoScore(b) - photoScore(a))
        .map((p) => p.gallery?.find((u) => !u.includes('idea-frames')) || p.image_url)
        .filter((u): u is string => Boolean(u) && !String(u).includes('idea-frames'))
        .slice(0, 5)
  const hasPhotos = photos.length > 0

  const actions = [
    { label: t('ai.open'), icon: <SparkIcon size={20} />, onClick: onAssistant, accent: true },
    { label: t('hero.calendar'), icon: <CalendarIcon size={20} />, onClick: onCalendar },
    { label: t('hub.share'), icon: <ShareIcon size={20} />, onClick: onShare },
    { label: editing ? t('common.cancel') : t('common.edit'), icon: <span className="text-[18px] leading-none">✎</span>, onClick: onEdit },
  ]

  return (
    <section className="mx-auto w-full max-w-6xl px-3 pt-3 sm:px-8 sm:pt-6">
      <div className="relative isolate overflow-hidden rounded-[32px] shadow-[var(--shadow-lg)]">
        {/* Fond : photos ou degrade */}
        <div className="absolute inset-0 -z-10">
          {hasPhotos ? (
            <div className={`grid h-full w-full gap-0.5 ${photos.length >= 3 ? 'grid-cols-3 grid-rows-2' : 'grid-cols-1'}`}>
              {photos.slice(0, photos.length >= 3 ? 3 : 1).map((u, i) => (
                <img
                  key={u}
                  src={u}
                  alt=""
                  referrerPolicy="no-referrer"
                  className={`h-full w-full object-cover ${photos.length >= 3 && i === 0 ? 'col-span-2 row-span-2' : ''}`}
                />
              ))}
            </div>
          ) : (
            <div className="h-full w-full bg-[radial-gradient(90%_120%_at_100%_0%,#ff8a5c,transparent_60%),radial-gradient(90%_120%_at_0%_100%,#2fb8a8,transparent_60%),linear-gradient(135deg,#ffb36b,#e85d75)]" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-black/10" />
        </div>

        <div className="flex min-h-[460px] flex-col justify-between p-5 text-white sm:min-h-[520px] sm:p-9">
          <div className="flex items-center justify-between gap-3">
            <Link
              to="/voyages"
              className="rounded-full bg-black/25 px-3.5 py-1.5 text-[13px] font-semibold backdrop-blur-md hover:bg-black/35"
            >
              ← {t('nav.trips')}
            </Link>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-white/20 px-3 py-1 text-[12px] font-bold backdrop-blur-md">
                {trip.status === 'planning' ? `🧳 ${t('hub.status.planning')}` : `✅ ${t('hub.status.done')}`}
              </span>
              {hub.people.length > 0 && (
                <div className="flex -space-x-2">
                  {hub.people.map((p) => (
                    <span key={p.user_id} className="rounded-full ring-2 ring-white/70" title={p.display_name}>
                      <Avatar url={p.avatar_url} name={p.display_name} size={28} />
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="mt-24 grid gap-7 lg:grid-cols-[1fr_auto] lg:items-end">
            <Reveal>
              {countries.length > 0 && (
                <p className="text-[34px] leading-none drop-shadow">{countries.map((c) => flagOf(c)).join(' ')}</p>
              )}
              <h1 className="display mt-3 text-[clamp(2.6rem,9vw,5.6rem)] drop-shadow-[0_4px_24px_rgba(0,0,0,0.35)]">
                {trip.title}
              </h1>
              <div className="mt-4 flex flex-wrap gap-2">
                <Pill>🗓️ {formatRange(trip.start_date, trip.end_date, t, locale)}</Pill>
                {totalDays && <Pill>☀️ {t('hub.days', { n: totalDays })}</Pill>}
                {hub.stops.length > 0 && (
                  <Pill>📍 {hub.stops.length === 1 ? t('hub.stop') : t('hub.stops', { n: hub.stops.length })}</Pill>
                )}
              </div>
            </Reveal>
            <Reveal delay={80}>
              <Countdown start={trip.start_date} end={trip.end_date} light />
            </Reveal>
          </div>
        </div>
      </div>

      {/* Actions : boutons ronds avec libelle, comme dans les apps iOS */}
      <div className="mt-5 grid grid-cols-4 gap-2 sm:flex sm:justify-start sm:gap-6">
        {actions.map((a) => (
          <button key={a.label} onClick={a.onClick} className="flex flex-col items-center gap-1.5 sm:w-20">
            <span
              className={`flex h-14 w-14 items-center justify-center rounded-full shadow-[var(--shadow-sm)] ${
                a.accent ? 'btn-accent border' : 'border border-line bg-surface text-accent backdrop-blur-xl'
              }`}
            >
              {a.icon}
            </span>
            <span className="text-center text-[12px] font-semibold leading-tight text-text-soft">{a.label}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="num rounded-full bg-white/20 px-3.5 py-1.5 text-[13px] font-semibold backdrop-blur-md">{children}</span>
  )
}
