import { useState } from 'react'
import { useDraft } from '../../lib/drafts'
import { errorMessage } from '../../lib/errors'
import { addIdea, extractUrl, useAnalyzerOnline } from '../../lib/ideas'
import { useI18n } from '../../i18n/I18nContext'
import { LinkIcon } from './icons'

/**
 * Coller un lien pour l'analyser. Le champ est un brouillon : un lien colle
 * puis abandonne se retrouve dans le tiroir « Brouillons ».
 */
export default function IdeaComposer({ tripId, initialUrl }: { tripId: string | null; initialUrl?: string }) {
  const { t } = useI18n()
  const online = useAnalyzerOnline()
  const draft = useDraft<{ url: string; note: string }>({
    key: `idea:${tripId ?? 'wishlist'}`,
    kind: 'idea',
    tripId,
    title: t('drafts.kind.idea'),
    initial: { url: initialUrl ?? '', note: '' },
    isEmpty: (v) => !v.url.trim() && !v.note.trim(),
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const url = extractUrl(draft.value.url) ?? ''

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!url) return
    setBusy(true)
    setError(null)
    try {
      await addIdea(url, draft.value.note.trim() || null, tripId)
      draft.clear()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="card-feature p-5 sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <LinkIcon size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            className="field pl-10"
            value={draft.value.url}
            onChange={(e) => draft.set({ ...draft.value, url: e.target.value })}
            placeholder={t('link.placeholder')}
            inputMode="url"
          />
        </div>
        <button type="submit" className="btn btn-accent" disabled={busy || !url}>
          {t('idea.add')}
        </button>
      </div>
      <input
        className="field mt-2 text-[13px]"
        value={draft.value.note}
        onChange={(e) => draft.set({ ...draft.value, note: e.target.value })}
        placeholder={t('idea.notePlaceholder')}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-text-muted">
        {online !== null && (
          <span className={`chip ${online ? 'chip-ok' : 'chip-warn'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-[var(--color-olive)]' : 'bg-[var(--color-ochre)]'}`} />
            {online ? t('idea.analyzerOn') : t('idea.analyzerOff')}
          </span>
        )}
      </div>
      {error && <p className="notice notice-bad mt-3">{error}</p>}
    </form>
  )
}
