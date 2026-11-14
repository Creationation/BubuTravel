import { useIdeas } from '../../lib/ideas'
import type { Trip } from '../../lib/types'
import type { TripHub } from '../../lib/useTripHub'
import { useI18n } from '../../i18n/I18nContext'
import IdeaComposer from './IdeaComposer'
import IdeasByDay from './IdeasByDay'

/** Les idees rattachees a ce voyage : liens analyses et a analyser. */
export default function IdeasTab({ trip }: { trip: Trip; hub: TripHub }) {
  const { t } = useI18n()
  const { ideas, loading } = useIdeas({ tripId: trip.id })

  return (
    <div className="space-y-8">
      <div className="max-w-2xl">
        <h2 className="display text-4xl">{t('link.title')}</h2>
        <p className="lede mt-3 text-[15px]">{t('link.intro')}</p>
      </div>
      <IdeaComposer tripId={trip.id} />
      {!loading && ideas.length === 0 ? (
        <p className="py-6 text-center text-text-muted">{t('idea.emptyHint')}</p>
      ) : (
        <IdeasByDay ideas={ideas} defaultTripId={trip.id} />
      )}
    </div>
  )
}
