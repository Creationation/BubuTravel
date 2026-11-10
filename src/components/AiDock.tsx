import { useEffect, useState } from 'react'
import { useAiJobs } from '../context/AiJobsContext'
import type { AiJob } from '../context/AiJobsContext'
import { useI18n } from '../i18n/I18nContext'
import AiGauge from './AiGauge'
import TaskCenter, { canRetry, useJobGo, useJobLabel } from './TaskCenter'

const running = (j: AiJob) => j.status === 'pending' || j.status === 'processing'

/**
 * Pastille flottante « IA » : ce qui tourne sur le PC, ce qui vient de se
 * terminer. On peut tout lancer puis continuer sa vie, l'app previent.
 */
export default function AiDock() {
  const { jobs, dismiss } = useAiJobs()
  const { t } = useI18n()
  const { retry } = useAiJobs()
  const [center, setCenter] = useState(false)
  const [open, setOpen] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  const active = jobs.filter(running)
  const done = jobs.filter((j) => !running(j)).slice(0, 6)

  // Petit signal quand une demande se termine
  const lastDone = done[0]?.id
  useEffect(() => {
    if (!lastDone) return
    const j = done[0]
    if (Date.now() - new Date(j.updated_at).getTime() > 20000) return
    setFlash(j.id)
    const timer = window.setTimeout(() => setFlash(null), 4000)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastDone])


  const label = useJobLabel()
  const go = useJobGo(() => setOpen(false))

  const flashed = jobs.find((j) => j.id === flash)

  return (
    <>
    {center && <TaskCenter onClose={() => setCenter(false)} />}
    <div className="pointer-events-none fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-3 z-[1200] flex flex-col items-end gap-2 sm:bottom-5 sm:right-5">
      {flashed && !open && (
        <button
          onClick={() => go(flashed)}
          className="fade-in pointer-events-auto max-w-[17rem] rounded-2xl border border-line bg-surface-solid px-3.5 py-2.5 text-left text-[13px] font-semibold shadow-[var(--shadow-md)]"
        >
          {flashed.status === 'error' ? '⚠️ ' : '✅ '}
          {label(flashed)}
        </button>
      )}

      {open && (
        <div className="fade-in pointer-events-auto w-[19rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-[22px] border border-line bg-surface-solid shadow-[var(--shadow-lg)]">
          <p className="border-b border-line px-4 py-3 text-[14px] font-extrabold">🤖 {t('ai.dockTitle')}</p>
          <ul className="max-h-[50vh] overflow-y-auto">
            {[...active, ...done].map((j) => (
              <li key={j.id} className="flex items-center gap-2.5 border-b border-line px-4 py-2.5 last:border-b-0">
                <span className="w-5 shrink-0 text-center">
                  {running(j) ? <span className="ai-spin inline-block">⏳</span> : j.status === 'error' ? '⚠️' : '✅'}
                </span>
                <button onClick={() => go(j)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-[13px] font-semibold">{label(j)}</span>
                  {running(j) ? (
                    <AiGauge job={j} compact queuePos={j.status === 'pending' ? active.filter((x) => x.status === 'pending' && x.created_at >= j.created_at).length : undefined} />
                  ) : (
                    <span className="block truncate text-[11px] text-text-muted">{j.status === 'error' ? j.error : t('ai.done')}</span>
                  )}
                </button>
                {canRetry(j) && (
                  <button onClick={() => void retry(j)} className="shrink-0 rounded-lg px-1.5 py-1 text-[12px] font-extrabold text-accent" aria-label={t('tc.retry')}>
                    ↻
                  </button>
                )}
                {!running(j) && (
                  <button onClick={() => dismiss(j.id)} className="shrink-0 text-[12px] text-text-muted" aria-label={t('common.close')}>
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button
            onClick={() => {
              setOpen(false)
              setCenter(true)
            }}
            className="w-full border-t border-line px-4 py-3 text-left text-[13px] font-extrabold text-accent"
          >
            📋 {t('tc.open')}
          </button>
          <p className="px-4 pb-2.5 text-[11px] text-text-muted">{t('ai.dockHint')}</p>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="pointer-events-auto flex h-12 items-center gap-2 rounded-full border border-line bg-surface-solid px-4 text-[14px] font-extrabold shadow-[var(--shadow-md)] transition-transform active:scale-95"
      >
        <span className={active.length ? 'ai-spin inline-block' : ''}>{active.length ? '✨' : '🤖'}</span>
        {active.length ? t('ai.running', { n: active.length }) : done.some((j) => j.status === 'error') ? `⚠️ ${t('tc.short')}` : t('ai.finished')}
      </button>
    </div>
    </>
  )
}
