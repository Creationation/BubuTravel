import { useEffect, useMemo, useState } from 'react'
import { usePlaces } from '../context/PlacesContext'
import { fetchStops } from '../lib/tripApi'
import {
  conflictsFor,
  durationOf,
  firstFreeSlot,
  fmtMinutes,
  loadOfDay,
  stopOf,
  suggestDays,
  toHHMM,
} from '../lib/schedule'
import type { Conflict } from '../lib/schedule'
import { shortDate } from '../lib/tripDates'
import type { Place, TripStop } from '../lib/types'
import { useI18n } from '../i18n/I18nContext'
import { useAiJobs } from '../context/AiJobsContext'

const DURATIONS = [30, 60, 90, 120, 180, 240, 480]

/**
 * « Integrer au voyage » : choisir un jour (les jours ou l'on est dans la
 * bonne ville sont proposes, les moins charges d'abord), une heure et une
 * duree. Avant d'enregistrer, ce qui coince est signale avec des choix :
 * decaler, autre jour, ou garder quand meme.
 */
export default function PlanBox({ place }: { place: Place }) {
  const { t, locale } = useI18n()
  const { places, edit } = usePlaces()
  const [stops, setStops] = useState<TripStop[]>([])
  const [open, setOpen] = useState(false)
  const [day, setDay] = useState<string>(place.visit_date ?? '')
  const [time, setTime] = useState<string>(place.plan_time ?? '')
  const [minutes, setMinutes] = useState<number>(durationOf(place))
  const [issues, setIssues] = useState<Conflict[] | null>(null)
  const [busy, setBusy] = useState(false)
  const { queue, jobs, activeFor } = useAiJobs()
  const [usedSlot, setUsedSlot] = useState<string | null>(null)
  const aiBusy = activeFor('schedule_place', 'place_id', place.id)
  const aiJob = jobs.find((j) => j.kind === 'schedule_place' && j.input?.place_id === place.id && j.status === 'ready')
  const aiSlot = aiJob && aiJob.id !== usedSlot ? (aiJob.result as { date: string; time: string; minutes: number; reason: string } | null) : null

  useEffect(() => {
    if (!place.trip_id) return
    void fetchStops(place.trip_id).then(setStops).catch(() => undefined)
  }, [place.trip_id])

  useEffect(() => {
    setDay(place.visit_date ?? '')
    setTime(place.plan_time ?? '')
    setMinutes(durationOf(place))
    setIssues(null)
    setOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place.id])

  const tripPlaces = useMemo(() => places.filter((p) => p.trip_id === place.trip_id), [places, place.trip_id])
  const stop = stopOf(place, stops)
  const days = useMemo(() => suggestDays(place, stops, tripPlaces), [place, stops, tripPlaces])

  if (!place.trip_id) return null

  function pickDay(d: string) {
    setDay(d)
    setIssues(null)
    // Heure proposee : le premier creneau libre de la journee
    if (!time) setTime(toHHMM(firstFreeSlot(loadOfDay(d, tripPlaces, place.id), minutes)))
  }

  async function save(force = false) {
    if (!day) return
    const found = conflictsFor(place, day, time || null, minutes, stops, tripPlaces)
    if (found.length && !force) {
      setIssues(found)
      return
    }
    setBusy(true)
    try {
      await edit(place.id, { visit_date: day, plan_time: time || null, plan_minutes: minutes })
      setIssues(null)
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  async function askAi() {
    await queue('schedule_place', { place_id: place.id, lang: locale.startsWith('fr') ? 'fr' : 'en' }, place.trip_id)
  }

  async function useSlot() {
    if (!aiSlot || !aiJob) return
    setUsedSlot(aiJob.id)
    setBusy(true)
    try {
      await edit(place.id, { visit_date: aiSlot.date, plan_time: aiSlot.time, plan_minutes: aiSlot.minutes })
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  const aiCard = aiSlot ? (
    <div className="fade-in rounded-2xl border-2 border-accent/40 bg-[var(--halo)] p-3.5">
      <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-accent">✨ {t('plan.aiSuggest')}</p>
      <p className="mt-1 text-[15px] font-extrabold capitalize">
        {shortDate(aiSlot.date, locale, true)} · {aiSlot.time} · {fmtMinutes(aiSlot.minutes)}
      </p>
      <p className="mt-1 text-[13px] leading-snug text-text-soft">{aiSlot.reason}</p>
      <div className="mt-3 flex gap-2">
        <button onClick={() => void useSlot()} disabled={busy} className="btn btn-accent btn-xs flex-1">
          {t('plan.aiUse')}
        </button>
        <button onClick={() => aiJob && setUsedSlot(aiJob.id)} className="btn btn-xs">
          {t('plan.aiNo')}
        </button>
      </div>
    </div>
  ) : aiBusy ? (
    <p className="rounded-2xl bg-surface-2 px-3.5 py-3 text-[13px] text-text-muted">
      <span className="ai-spin inline-block">✨</span> {t('plan.aiBusy')}
    </p>
  ) : null

  async function unplan() {
    await edit(place.id, { visit_date: null, plan_time: null, plan_minutes: null })
    setDay('')
    setTime('')
  }

  // Deja prevu : resume en une ligne
  if (!open && place.visit_date && place.status === 'wishlist') {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface px-3.5 py-3">
        <p className="min-w-0 flex-1 text-[14px] font-semibold">
          {t('plan.planned', { date: shortDate(place.visit_date, locale, true) })}
          {place.plan_time && <span className="font-normal text-text-muted"> {t('plan.at', { time: place.plan_time })}</span>}
        </p>
        <button onClick={() => setOpen(true)} className="btn btn-xs">
          {t('plan.change')}
        </button>
      </div>
    )
  }

  if (!open) {
    return (
      <div className="space-y-2">
        {aiCard}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setOpen(true)} className="btn">
            📅 {t('plan.title')}
          </button>
          <button onClick={() => void askAi()} disabled={Boolean(aiBusy)} className="btn btn-accent">
            ✨ {t('plan.aiAsk')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 rounded-2xl border border-line bg-surface p-3.5">
      <div className="flex items-center justify-between">
        <p className="text-[15px] font-bold">{t('plan.title')}</p>
        <button onClick={() => setOpen(false)} className="btn btn-quiet btn-xs">
          {t('common.close')}
        </button>
      </div>

      {aiCard}

      {/* Jours proposes */}
      <div>
        <p className="label">{t('plan.days')}</p>
        {days.length > 0 ? (
          <>
            <p className="-mt-1 mb-2 text-[12px] text-text-muted">{t('plan.daysHint', { city: stop?.name ?? '' })}</p>
            <div className="nav-scroll -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {days.map((d) => (
                <button
                  key={d.day}
                  onClick={() => pickDay(d.day)}
                  className={`flex min-w-[5.5rem] shrink-0 flex-col items-start rounded-2xl border px-3 py-2 text-left ${
                    day === d.day ? 'border-accent bg-[var(--halo)]' : 'border-line'
                  }`}
                >
                  <span className="text-[13px] font-bold">{shortDate(d.day, locale, true)}</span>
                  <span className={`text-[11px] ${d.minutes === 0 ? 'text-[var(--color-olive)]' : 'text-text-muted'}`}>
                    {d.minutes === 0 ? `✨ ${t('plan.free')}` : `${d.items.length} · ${fmtMinutes(d.minutes)}`}
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="mb-2 text-[12px] text-text-muted">{t('plan.noStop', { city: place.city ?? '' })}</p>
        )}
        <input
          type="date"
          className="field num mt-2"
          value={day}
          onChange={(e) => pickDay(e.target.value)}
          aria-label={t('plan.otherDay')}
        />
      </div>

      {/* Heure et duree */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="label">{t('plan.time')}</p>
          <input type="time" className="field num" value={time} onChange={(e) => { setTime(e.target.value); setIssues(null) }} />
          <div className="mt-1.5 flex gap-1">
            {[
              ['09:00', t('plan.morning')],
              ['14:00', t('plan.afternoon')],
              ['19:00', t('plan.evening')],
            ].map(([v, l]) => (
              <button key={v} onClick={() => { setTime(v); setIssues(null) }} className={`pill px-2 py-0.5 text-[11px] ${time === v ? 'pill-active' : ''}`}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="label">{t('plan.duration')}</p>
          <select className="field" value={minutes} onChange={(e) => { setMinutes(Number(e.target.value)); setIssues(null) }}>
            {[...new Set([minutes, ...DURATIONS])].sort((a, b) => a - b).map((m) => (
              <option key={m} value={m}>
                {fmtMinutes(m)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Ce qui coince, avec les choix */}
      {issues && issues.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-[rgba(196,128,32,0.4)] bg-[rgba(216,162,74,0.12)] p-3">
          {issues.map((c, i) => (
            <p key={i} className="text-[13px] leading-snug">
              {c.kind === 'elsewhere'
                ? c.there
                  ? t('plan.c.elsewhere', { there: c.there, city: c.city ?? '' })
                  : t('plan.c.elsewhereNone', { city: c.city ?? '' })
                : c.kind === 'overlap'
                  ? t('plan.c.overlap', { name: c.with.name, time: c.with.plan_time ?? '' })
                  : t('plan.c.full', { h: fmtMinutes(c.minutes) })}
            </p>
          ))}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {issues.map((c) =>
              c.kind === 'overlap' ? (
                <button key="later" onClick={() => { setTime(c.nextFree); setIssues(null) }} className="btn btn-xs btn-accent">
                  {t('plan.fixLater', { time: c.nextFree })}
                </button>
              ) : null,
            )}
            <button onClick={() => { setIssues(null); setDay('') }} className="btn btn-xs">
              {t('plan.fixDay')}
            </button>
            <button onClick={() => void save(true)} className="btn btn-xs btn-quiet" disabled={busy}>
              {t('plan.keep')}
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={() => void save()} className="btn btn-accent flex-1" disabled={!day || busy}>
          {t('plan.confirm')}
        </button>
        {place.visit_date && (
          <button onClick={() => void unplan()} className="btn btn-quiet">
            {t('plan.remove')}
          </button>
        )}
      </div>
    </div>
  )
}
