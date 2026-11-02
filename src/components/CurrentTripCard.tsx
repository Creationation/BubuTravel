import { Link } from 'react-router-dom'
import { usePlaces } from '../context/PlacesContext'
import { pickCurrentTrip } from '../lib/currentTrip'
import { countdown } from '../lib/tripDates'
import { formatRange } from '../lib/stats'
import { useI18n } from '../i18n/I18nContext'
import { useCoverUrl } from './TripCover'
import { RouteIcon } from './hub/icons'
import Countdown from './Countdown'
import { autoCover } from '../lib/discover'

/**
 * En haut de l'accueil : le voyage du moment, en un tap. C'est le chemin le
 * plus court vers ce qui compte pendant le voyage.
 */
export default function CurrentTripCard() {
  const { t, locale } = useI18n()
  const { trips, loading } = usePlaces()
  const trip = pickCurrentTrip(trips)
  const own = useCoverUrl(trip?.cover_url ?? null)
  const { places } = usePlaces()
  const cover = own ?? (trip ? autoCover(trip.id, places) : null)
  if (loading) return null

  if (!trip) {
    return (
      <Link to="/voyages?nouveau=1" className="card-feature mt-8 flex items-center gap-4 p-5">
        <span className="glyph h-12 w-12">
          <RouteIcon size={20} />
        </span>
        <span>
          <span className="block text-[16px] font-semibold">{t('home.noTrip')}</span>
          <span className="block text-[13px] text-accent">{t('home.createTrip')} →</span>
        </span>
      </Link>
    )
  }

  const cd = countdown(trip.start_date, trip.end_date)
  const label =
    cd.kind === 'before'
      ? cd.days <= 1
        ? cd.days === 0
          ? t('hub.countdown.today')
          : t('hub.countdown.tomorrow')
        : t('hub.countdown.before', { n: cd.days })
      : cd.kind === 'during'
        ? t('hub.countdown.during', { day: cd.day, total: cd.total })
        : cd.kind === 'after'
          ? t('hub.countdown.after', { n: cd.days })
          : ''

  return (
    <Link
      to={`/voyages/${trip.id}`}
      className="card-feature group relative mt-8 block overflow-hidden p-6 sm:p-8"
    >
      {cover && (
        <>
          <img src={cover} alt="" className="absolute inset-0 -z-10 h-full w-full object-cover opacity-90" />
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#120d09]/80 to-[#120d09]/20" />
        </>
      )}
      <div className={cover ? 'text-[#fbf3e8]' : ''}>
        <p className="eyebrow eyebrow-dot">{t('home.currentTrip')}</p>
        <h2 className="display mt-4 text-[clamp(2.2rem,6vw,3.6rem)]">{trip.title}</h2>
        <p className="num mt-2 text-[14px] opacity-80">{formatRange(trip.start_date, trip.end_date, t, locale)}</p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {cd.kind === 'before' ? (
            <Countdown start={trip.start_date} end={trip.end_date} size="sm" light={Boolean(cover)} />
          ) : (
            label && <span className="display-sm num text-[1.35rem] text-accent">{label}</span>
          )}
          <span className="btn btn-accent ml-auto">{t('home.openTrip')} →</span>
        </div>
      </div>
    </Link>
  )
}
