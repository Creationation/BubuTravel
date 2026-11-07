import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlaces } from '../../context/PlacesContext'
import { errorMessage } from '../../lib/errors'
import { findSights, queueSights, sightsOf } from '../../lib/sights'
import MapCanvas from '../MapCanvas'
import StopForm, { modeKey } from './StopForm'
import {
  mapsLink,
  nightsOf,
  routeIssues,
  shortDate,
  shortDateTime,
  todayIso,
} from '../../lib/tripDates'
import type { Trip, TripStop } from '../../lib/types'
import type { TripHub } from '../../lib/useTripHub'
import { useI18n } from '../../i18n/I18nContext'
import ClampText from '../ClampText'
import StopProgramme from './StopProgramme'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BedIcon,
  ExternalIcon,
  PlusIcon,
  SparkIcon,
  TransportIcon,
} from './icons'
import { countryName } from '../../lib/countryName'
import { HostCards } from './HostContacts'
import { placeName } from '../../lib/discover'
import { updateStop } from '../../lib/tripApi'
import EditButton from '../EditButton'
import { useScope } from '../../context/TripScope'
import RouteSheet from '../RouteSheet'
import type { RoutePoint } from '../RouteSheet'

/**
 * L'itineraire : une carte avec le trace des etapes, puis la frise verticale
 * etape par etape, chaque trajet glisse entre deux etapes comme un billet.
 */
export default function RouteTab({
  trip,
  hub,
  autoAdd = false,
  onOpenAssistant,
}: {
  trip: Trip
  hub: TripHub
  autoAdd?: boolean
  onOpenAssistant: () => void
}) {
  const { t, locale, lang } = useI18n()
  const navigate = useNavigate()
  const { places, reload: reloadPlaces } = usePlaces()
  const [sightBusy, setSightBusy] = useState<string | null>(null)
  const [sightMsg, setSightMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [editing, setEditing] = useState<string | 'new' | null>(autoAdd ? 'new' : null)
  const { stops } = hub
  const issues = useMemo(() => routeIssues(stops), [stops])
  const today = todayIso()

  const located = stops.filter((s) => s.lat != null && s.lng != null)
  const routeLine = located.length > 1
    ? [{ id: 'route', name: trip.title, points: located.map((s, i) => ({ t: i, lat: s.lat!, lng: s.lng! })) }]
    : []

  const [dirTo, setDirTo] = useState<RoutePoint | null>(null)
  const scope = useScope()
  const tripSights = scope.places(places.filter((p) => p.trip_id === trip.id))

  async function sights(stop: TripStop) {
    setSightBusy(stop.id)
    setSightMsg(null)
    try {
      const res = await findSights(stop, places, lang)
      await reloadPlaces()
      setSightMsg({ ok: true, text: t('stop.sightsDone', { n: res.added ?? 0 }) })
    } catch (err) {
      setSightMsg({ ok: false, text: errorMessage(err) })
    } finally {
      setSightBusy(null)
    }
  }

  async function sightsForAll() {
    setSightMsg(null)
    try {
      await queueSights(stops.filter((s) => sightsOf(s, places).length === 0), places, lang)
      setSightMsg({ ok: true, text: t('stop.sightsQueued') })
    } catch (err) {
      setSightMsg({ ok: false, text: errorMessage(err) })
    }
  }

  const last = stops[stops.length - 1]
  const defaultArrive = last?.leave_date ?? trip.start_date ?? null

  return (
    <div className="space-y-8">
      {located.length > 0 && (
        <div className="h-[340px] overflow-hidden rounded-[24px] border border-line shadow-[var(--shadow-sm)] sm:h-[420px]">
          <MapCanvas
            points={located.map((s) => ({
              id: s.id,
              lat: s.lat!,
              lng: s.lng!,
              name: s.name,
              country: s.country ?? '',
            })).concat(
              tripSights.map((p) => ({ id: `p:${p.id}`, lat: p.lat, lng: p.lng, name: p.name, country: p.country, wish: true })),
            )}
            tracks={routeLine}
            cluster={false}
            onSelect={(id) => {
              if (id.startsWith('p:')) return navigate(`/carte?lieu=${id.slice(2)}`)
              setEditing(null)
              document.getElementById(`stop-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }}
          />
        </div>
      )}

      {issues.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {issues.map((issue) => (
            <span key={`${issue.a.id}-${issue.b.id}`} className="chip chip-warn">
              {issue.kind === 'gap'
                ? t('hub.gapWarning', {
                    start: shortDate(issue.a.leave_date, locale),
                    end: shortDate(issue.b.arrive_date, locale),
                  })
                : t('hub.overlapWarning', { a: issue.a.name, b: issue.b.name })}
            </span>
          ))}
        </div>
      )}

      {sightMsg && <p className={`notice ${sightMsg.ok ? '' : 'notice-bad'}`}>{sightMsg.text}</p>}

      {stops.length === 0 && editing !== 'new' && (
        <div className="card-feature px-6 py-12 text-center sm:px-12">
          <p className="eyebrow eyebrow-dot justify-center">{t('hub.tab.route')}</p>
          <h3 className="display mx-auto mt-4 max-w-lg text-4xl sm:text-5xl">{t('stop.empty')}</h3>
          <p className="lede mx-auto mt-4 max-w-xl">{t('stop.emptyHint')}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <button onClick={onOpenAssistant} className="btn btn-accent btn-lg">
              <SparkIcon size={16} />
              {t('ai.open')}
            </button>
            <button onClick={() => setEditing('new')} className="btn btn-lg">
              <PlusIcon size={16} />
              {t('stop.add')}
            </button>
          </div>
        </div>
      )}

      {stops.length > 0 && (
        <ol className="relative">
          {stops.map((stop, i) => {
            const next = stops[i + 1]
            const isNow =
              stop.arrive_date && stop.arrive_date <= today && (!stop.leave_date || stop.leave_date > today)
            if (editing === stop.id) {
              return (
                <li key={stop.id} className="mb-6">
                  <StopForm
                    stop={stop}
                    isLast={!next}
                    onCancel={() => setEditing(null)}
                    onSave={async (draft) => {
                      await hub.editStop(stop.id, draft)
                      setEditing(null)
                    }}
                    onDelete={async () => {
                      await hub.removeStop(stop.id)
                      setEditing(null)
                    }}
                  />
                </li>
              )
            }
            return (
              <li key={stop.id} id={`stop-${stop.id}`} className="relative pl-12 sm:pl-16">
                {/* Fil de la frise */}
                <span className="absolute bottom-0 left-[19px] top-0 w-px bg-line sm:left-[27px]" aria-hidden />
                <span
                  className={`absolute left-0 top-5 flex h-10 w-10 items-center justify-center rounded-full border text-[13px] font-semibold num sm:left-2 ${
                    isNow
                      ? 'border-accent bg-accent text-accent-ink shadow-[0_0_0_6px_var(--halo)]'
                      : 'border-line-strong bg-surface text-text-soft'
                  }`}
                >
                  {i + 1}
                </span>

                <StopCard
                  stop={stop}
                  index={i}
                  total={stops.length}
                  isNow={Boolean(isNow)}
                  onEdit={() => setEditing(stop.id)}
                  onMove={(d) => void hub.moveStop(i, d)}
                />

                {(stop.transport_mode || stop.transport_departs) && (
                  <TransportTicket stop={stop} next={next} />
                )}
                <div className="h-6" />
              </li>
            )
          })}
        </ol>
      )}

      {editing === 'new' ? (
        <StopForm
          isLast={false}
          defaultArrive={defaultArrive}
          onCancel={() => setEditing(null)}
          onSave={async (draft) => {
            await hub.addStop(draft)
            setEditing(null)
          }}
        />
      ) : (
        stops.length > 0 && (
          <div className="flex flex-wrap gap-3 pl-12 sm:pl-16">
            <button onClick={() => setEditing('new')} className="btn">
              <PlusIcon size={16} />
              {t('stop.add')}
            </button>
            <button onClick={() => void sightsForAll()} className="btn btn-quiet">
              <SparkIcon size={16} />
              {t('stop.sightsAll')}
            </button>
            <button onClick={onOpenAssistant} className="btn btn-quiet">
              <SparkIcon size={16} />
              {t('ai.open')}
            </button>
          </div>
        )
      )}
      {dirTo && <RouteSheet to={dirTo} tripId={trip.id} onClose={() => setDirTo(null)} />}
    </div>
  )

  function StopCard({
    stop,
    index,
    total,
    isNow,
    onEdit,
    onMove,
  }: {
    stop: TripStop
    index: number
    total: number
    isNow: boolean
    onEdit: () => void
    onMove: (delta: number) => void
  }) {
    const nights = nightsOf(stop)
    return (
      <article className={`card card-hover p-5 sm:p-6 ${isNow ? 'border-accent/50' : ''}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow num">
              {stop.arrive_date
                ? `${shortDate(stop.arrive_date, locale, true)}${
                    stop.leave_date ? `  ·  ${shortDate(stop.leave_date, locale, true)}` : ''
                  }`
                : t('stop.noDates')}
            </p>
            <button onClick={onEdit} className="mt-2 block text-left">
              <h3 className="display-sm text-[1.75rem] leading-tight hover:text-accent">{stop.name}</h3>
            </button>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {stop.country && <span className="chip">{countryName(stop.country)}</span>}
              {nights !== null && (
                <span className="chip chip-accent num">
                  {nights === 1 ? t('hub.night') : t('hub.nights', { n: nights })}
                </span>
              )}
              {isNow && <span className="chip chip-ok">{t('hub.currentStop')}</span>}
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-1 sm:w-auto sm:shrink-0">
            <button
              onClick={() => onMove(-1)}
              disabled={index === 0}
              className="btn btn-quiet btn-icon"
              aria-label={t('stop.moveUp')}
            >
              <ArrowUpIcon size={15} />
            </button>
            <button
              onClick={() => onMove(1)}
              disabled={index === total - 1}
              className="btn btn-quiet btn-icon"
              aria-label={t('stop.moveDown')}
            >
              <ArrowDownIcon size={15} />
            </button>
            <button onClick={() => void sights(stop)} className="btn btn-xs" disabled={sightBusy !== null}>
              <SparkIcon size={13} />
              {sightBusy === stop.id ? t('common.wait') : t('stop.sights')}
            </button>
            <EditButton onClick={onEdit} />
          </div>
        </div>

        {(stop.stay_name || stop.stay_address) && (
          <div className="mt-5 flex flex-wrap items-start gap-3 rounded-2xl bg-surface-2 p-3.5">
            <span className="glyph h-9 w-9">
              <BedIcon size={16} />
            </span>
            <div className="min-w-0 flex-1 text-[13px]">
              {stop.stay_name && <p className="font-semibold">{stop.stay_name}</p>}
              {stop.stay_address && <p className="text-text-muted">{stop.stay_address}</p>}
              {stop.stay_ref && (
                <p className="mt-0.5 text-text-muted">
                  {t('stop.booking')} <span className="num font-medium text-text-soft">{stop.stay_ref}</span>
                </p>
              )}
            </div>
            <div className="flex w-full flex-wrap gap-1 sm:w-auto sm:shrink-0 sm:flex-col sm:items-end">
              <EditButton onClick={onEdit} />
              {stop.lat != null && stop.lng != null && (
                <button onClick={() => setDirTo({ lat: stop.lat!, lng: stop.lng!, name: stop.stay_name || stop.name })} className="btn btn-accent btn-xs">
                  🧭 {t('dir.title')}
                </button>
              )}
              <a href={mapsLink(stop)} target="_blank" rel="noreferrer" className="btn btn-quiet btn-xs">
                {t('stop.openMap')}
              </a>
              {stop.stay_url && (
                <a href={stop.stay_url} target="_blank" rel="noreferrer" className="btn btn-quiet btn-xs">
                  <ExternalIcon size={13} />
                  {t('stop.booking')}
                </a>
              )}
            </div>
          </div>
        )}

        <HostCards hosts={stop.hosts} onSave={async (next) => { await updateStop(stop.id, { hosts: next }); await hub.reload() }} />

        {sightBusy === stop.id && <p className="mt-4 text-[13px] text-text-muted">{t('stop.sightsBusy')}</p>}
        {sightsOf(stop, places).length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            <span className="chip chip-accent num">{t('stop.sightsCount', { n: sightsOf(stop, places).length })}</span>
            {sightsOf(stop, places)
              .slice(0, 6)
              .map((p) => (
                <button key={p.id} onClick={() => navigate(`/carte?lieu=${p.id}`)} className="chip hover:border-accent">
                  {placeName(p)}
                </button>
              ))}
          </div>
        )}
        <StopProgramme
          stop={stop}
          stops={stops}
          places={tripSights}
          onOpen={(id) => navigate(`/carte?lieu=${id}`)}
        />
        {stop.notes && (
          <ClampText text={stop.notes} lines={4} className="mt-4 text-[14px] leading-relaxed text-text-soft" />
        )}
      </article>
    )
  }

  function TransportTicket({ stop, next }: { stop: TripStop; next?: TripStop }) {
    const mode = stop.transport_mode ?? 'other'
    return (
      <div className="relative my-3 ml-2 flex items-center gap-3 rounded-2xl border border-dashed border-line-strong bg-bg/60 px-4 py-3">
        <span className="glyph h-9 w-9">
          <TransportIcon mode={stop.transport_mode} size={16} />
        </span>
        <div className="min-w-0 flex-1 text-[13px]">
          <p className="font-semibold">
            {t(modeKey(mode))}
            {next && <span className="font-normal text-text-muted"> {t('stop.toNext', { name: next.name })}</span>}
          </p>
          <p className="num text-text-muted">
            {stop.transport_departs && shortDateTime(stop.transport_departs, locale)}
            {stop.transport_arrives && `  →  ${shortDateTime(stop.transport_arrives, locale)}`}
          </p>
          {stop.transport_details && <p className="truncate text-text-soft">{stop.transport_details}</p>}
        </div>
        {stop.transport_ref && <span className="chip num">{stop.transport_ref}</span>}
      </div>
    )
  }
}
