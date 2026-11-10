import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAiJobs } from '../context/AiJobsContext'
import type { AiJob } from '../context/AiJobsContext'
import { useAuth } from '../context/AuthContext'
import { useFeedback } from '../context/FeedbackContext'
import { usePlaces } from '../context/PlacesContext'
import { supabase } from '../lib/supabase'
import { useI18n } from '../i18n/I18nContext'
import type { Key } from '../i18n/fr'
import AiGauge from './AiGauge'
import Portal from './Portal'

export const isRunning = (j: AiJob) => j.status === 'pending' || j.status === 'processing'
/** Une photo de recu est effacee une fois lue : impossible de la refaire. */
export const canRetry = (j: AiJob) => j.status === 'error' && j.kind !== 'receipt_scan'

const COLS = 'id, kind, trip_id, input, status, result, error, progress, step, created_at, updated_at'

/** Libelle lisible d'une tache (« Contact de Kamala 1BR », « Fiche de Tulum Skybar »...). */
export function useJobLabel() {
  const { t } = useI18n()
  const { places, trips } = usePlaces()
  return (j: AiJob): string => {
    const place = places.find((p) => p.id === j.input?.place_id)
    const trip = trips.find((x) => x.id === j.trip_id)
    const name = place?.name ?? (j.input?.stay as string) ?? (j.input?.day as string) ?? (j.input?.country as string) ?? trip?.title ?? ''
    return t(`ai.kind.${j.kind}` as Key, { name })
  }
}

export function useJobGo(onDone?: () => void) {
  const navigate = useNavigate()
  return (j: AiJob) => {
    onDone?.()
    const placeId = j.input?.place_id as string | undefined
    if (placeId) navigate(`/carte?lieu=${placeId}`)
    else if (j.kind === 'host_search') navigate('/hebergements')
    else if (j.kind === 'chat' && j.trip_id) navigate(`/voyages/${j.trip_id}?onglet=assistant`)
    else if (j.kind === 'day_plan' && j.trip_id) navigate(`/voyages/${j.trip_id}?onglet=day&jour=${j.input?.day ?? ''}`)
    else if (j.trip_id) navigate(`/voyages/${j.trip_id}?onglet=route`)
  }
}

function ago(iso: string, lang: string) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
  if (min < 60) return rtf.format(-min, 'minute')
  if (min < 60 * 24) return rtf.format(-Math.round(min / 60), 'hour')
  return rtf.format(-Math.round(min / 1440), 'day')
}

/** Centre de taches : ce qui tourne, ce qui est a refaire (avec « Recommencer »), ce qui est termine. */
export default function TaskCenter({ onClose }: { onClose: () => void }) {
  const { t, locale } = useI18n()
  const { user } = useAuth()
  const { jobs: live, retry } = useAiJobs()
  const fb = useFeedback()
  const label = useJobLabel()
  const go = useJobGo(onClose)
  const [rows, setRows] = useState<AiJob[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    const since = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString()
    const { data } = await supabase.from('ai_jobs').select(COLS).eq('user_id', user.id).gt('created_at', since).order('created_at', { ascending: false }).limit(60)
    setRows((data ?? []) as unknown as AiJob[])
    setLoading(false)
  }, [user])

  const sig = live.map((j) => `${j.id}${j.status}`).join()
  useEffect(() => {
    void load()
  }, [load, sig])
  useEffect(() => {
    const id = window.setInterval(() => void load(), 6000)
    return () => window.clearInterval(id)
  }, [load])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const running = useMemo(() => rows.filter(isRunning), [rows])
  const failed = useMemo(() => rows.filter((j) => j.status === 'error'), [rows])
  const done = useMemo(() => rows.filter((j) => j.status === 'ready'), [rows])
  const retryable = failed.filter(canRetry)

  async function again(j: AiJob) {
    setBusy(j.id)
    try {
      await retry(j)
      fb.toast(t('tc.restarted'), { icon: '↻' })
      await load()
    } catch (err) {
      fb.toast(err instanceof Error ? err.message : String(err), { icon: '⚠️', tone: 'bad' })
    } finally {
      setBusy(null)
    }
  }

  async function againAll() {
    setBusy('all')
    for (const j of retryable) {
      try {
        await retry(j)
      } catch {
        /* on continue avec les suivantes */
      }
    }
    fb.toast(t('tc.restartedN', { n: retryable.length }), { icon: '↻' })
    await load()
    setBusy(null)
  }

  const Section = ({ title, count, children }: { title: string; count: number; children: React.ReactNode }) =>
    count === 0 ? null : (
      <section>
        <p className="mb-2 text-[12.5px] font-extrabold uppercase tracking-[0.08em] text-text-muted">
          {title} ({count})
        </p>
        <ul className="space-y-2">{children}</ul>
      </section>
    )

  return (
    <Portal>
      <div className="fixed inset-0 z-[2900] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
        <div className="absolute inset-0 bg-[#120d09]/60" onClick={onClose} />
        <div className="sheet-in relative flex h-[88dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] bg-surface-solid shadow-[var(--shadow-lg)] sm:rounded-[28px]">
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <p className="text-[1.2rem] font-extrabold leading-tight">📋 {t('tc.title')}</p>
              <p className="text-[12.5px] text-text-muted">{t('tc.sub')}</p>
            </div>
            <button onClick={onClose} className="btn btn-quiet btn-xs shrink-0">
              {t('common.close')}
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            {loading && <p className="text-[13px] text-text-muted">{t('common.wait')}</p>}
            {!loading && rows.length === 0 && <p className="rounded-2xl bg-surface-2 px-4 py-3 text-[13px] text-text-muted">{t('tc.empty')}</p>}

            <Section title={`⏳ ${t('tc.running')}`} count={running.length}>
              {running.map((j) => (
                <li key={j.id} className="rounded-2xl border border-line bg-surface px-3.5 py-3">
                  <p className="mb-1 truncate text-[14px] font-bold">{label(j)}</p>
                  <AiGauge job={j} compact queuePos={j.status === 'pending' ? running.filter((x) => x.status === 'pending' && x.created_at >= j.created_at).length : undefined} />
                </li>
              ))}
            </Section>

            {failed.length > 0 && (
              <div className="space-y-2">
                <Section title={`⚠️ ${t('tc.failed')}`} count={failed.length}>
                  {failed.map((j) => (
                    <li key={j.id} className="rounded-2xl border border-[#b4533f]/40 bg-surface px-3.5 py-3">
                      <p className="truncate text-[14px] font-bold">{label(j)}</p>
                      <p className="mt-0.5 line-clamp-2 text-[12px] text-text-muted">{j.error || t('tc.unknownError')}</p>
                      <div className="mt-2 flex items-center gap-2">
                        {canRetry(j) && (
                          <button onClick={() => void again(j)} disabled={busy !== null} className="btn btn-accent btn-xs">
                            {busy === j.id ? t('common.wait') : `↻ ${t('tc.retry')}`}
                          </button>
                        )}
                        <span className="num ml-auto text-[11px] text-text-muted">{ago(j.updated_at, locale)}</span>
                      </div>
                    </li>
                  ))}
                </Section>
                {retryable.length > 1 && (
                  <button onClick={() => void againAll()} disabled={busy !== null} className="btn w-full">
                    ↻ {t('tc.retryAll', { n: retryable.length })}
                  </button>
                )}
              </div>
            )}

            <Section title={`✅ ${t('tc.done')}`} count={done.length}>
              {done.slice(0, 25).map((j) => (
                <li key={j.id}>
                  <button onClick={() => go(j)} className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface px-3.5 py-3 text-left active:scale-[0.98]">
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{label(j)}</span>
                    <span className="num shrink-0 text-[11px] text-text-muted">{ago(j.updated_at, locale)}</span>
                  </button>
                </li>
              ))}
            </Section>
          </div>
        </div>
      </div>
    </Portal>
  )
}
