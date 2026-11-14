import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import AppShell from '../components/AppShell'
import Reveal from '../components/Reveal'
import IdeasByDay from '../components/hub/IdeasByDay'
import IdeaComposer from '../components/hub/IdeaComposer'
import { addIdea, extractUrl, useIdeas } from '../lib/ideas'
import { errorMessage } from '../lib/errors'
import { useI18n } from '../i18n/I18nContext'

/**
 * La wishlist des idees : tous les liens analyses, avec ou sans voyage.
 * C'est aussi la cible du partage Android (« Partager vers BuBuTravel ») :
 * le lien recu dans ?url= ou ?text= est envoye tout de suite a l'analyse.
 */
export default function IdeasPage() {
  const { t } = useI18n()
  const [params, setParams] = useSearchParams()
  const { ideas, loading } = useIdeas()
  const [shareError, setShareError] = useState<string | null>(null)
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    const shared = extractUrl([params.get('url'), params.get('text'), params.get('title')].filter(Boolean).join(' '))
    if (!shared) return
    handled.current = true
    addIdea(shared, null, null)
      .catch((err) => setShareError(errorMessage(err)))
      .finally(() => setParams({}, { replace: true }))
  }, [params, setParams])

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-6xl px-5 pb-28 sm:px-8">
        <section className="py-12 sm:py-16">
          <Reveal>
            <p className="eyebrow eyebrow-dot">{t('idea.pageEyebrow')}</p>
            <h1 className="display mt-5 max-w-3xl text-[clamp(2.6rem,7vw,5rem)]">{t('idea.pageTitle')}</h1>
            <p className="lede mt-5 max-w-2xl">{t('idea.pageLede')}</p>
          </Reveal>
        </section>

        <Reveal delay={80}>
          <IdeaComposer tripId={null} />
        </Reveal>
        {shareError && <p className="notice notice-bad mt-4">{shareError}</p>}

        <div className="mt-10">
          {!loading && ideas.length === 0 ? (
            <div className="card px-8 py-14 text-center">
              <h2 className="display-sm text-2xl">{t('idea.empty')}</h2>
              <p className="lede mx-auto mt-3 max-w-lg text-[15px]">{t('idea.emptyHint')}</p>
            </div>
          ) : (
            <IdeasByDay ideas={ideas} />
          )}
        </div>
      </div>
    </AppShell>
  )
}
