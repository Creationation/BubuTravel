import type { AiJob } from '../context/AiJobsContext'
import { useI18n } from '../i18n/I18nContext'
import type { Key } from '../i18n/fr'

/**
 * Jauge d'avancement REELLE d'une demande a l'IA : le pourcentage vient de
 * l'analyseur, qui le fait avancer a chaque vraie etape (recherche web, page
 * lue, photo verifiee, enregistrement). La barre glisse en douceur entre deux
 * valeurs, sans jamais inventer de progression.
 */
export default function AiGauge({ job, compact = false, queuePos }: { job: AiJob; compact?: boolean; queuePos?: number }) {
  const { t } = useI18n()
  const pct = job.status === 'ready' ? 100 : job.status === 'pending' ? 0 : Math.max(1, job.progress ?? 0)
  // L'analyseur ecrit au moins toutes les minutes : au-dela de 3 min sans
  // nouvelles, la demande attend que le PC la reprenne
  const stale = job.status === 'processing' && Date.now() - new Date(job.updated_at).getTime() > 3 * 60 * 1000
  const [code, ...rest] = (job.step ?? '').split(':')
  const arg = rest.join(':').trim()
  const label =
    stale
      ? t('ai.stale')
      : job.status === 'pending'
      ? queuePos && queuePos > 1
        ? t('ai.queued', { n: queuePos })
        : t('ai.next')
      : job.status === 'ready'
        ? t('ai.done')
        : code
          ? t(`ai.step.${code}` as Key, { x: arg })
          : t('ai.working')

  return (
    <div className={compact ? '' : 'space-y-1.5'}>
      <div className="flex items-baseline justify-between gap-2">
        <p className={`min-w-0 truncate ${compact ? 'text-[11px]' : 'text-[12px]'} font-semibold text-text-muted`}>{label}</p>
        <span className={`num shrink-0 font-extrabold text-accent ${compact ? 'text-[11px]' : 'text-[13px]'}`}>{pct} %</span>
      </div>
      <div className={`relative overflow-hidden rounded-full bg-surface-2 ${compact ? 'mt-1 h-1.5' : 'h-2.5'}`}>
        <div
          className="ai-gauge-fill absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${pct}%`, transition: 'width 1.2s cubic-bezier(.22,1,.36,1)' }}
        />
      </div>
    </div>
  )
}
