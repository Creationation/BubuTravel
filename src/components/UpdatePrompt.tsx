import { useRegisterSW } from 'virtual:pwa-register/react'
import { useT } from '../i18n/I18nContext'

/**
 * L'app est installable et fonctionne hors ligne. Un service worker garde
 * l'ancienne version tant qu'on ne l'a pas remplacee, d'ou cette invite :
 * sans elle, une correction poussee ce matin resterait invisible pendant des
 * jours sur un telephone qui ne ferme jamais l'onglet.
 */
export default function UpdatePrompt() {
  const t = useT()
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!offlineReady && !needRefresh) return null

  return (
    <div className="fade-in fixed bottom-5 left-1/2 z-[1400] w-[min(92vw,26rem)] -translate-x-1/2">
      <div className="panel flex items-center gap-3 px-4 py-3 shadow-xl">
        <p className="min-w-0 flex-1 text-[13px] text-text-soft">
          {needRefresh
            ? t('pwa.updateReady')
            : t('pwa.offlineReady')}
        </p>
        {needRefresh && (
          <button onClick={() => void updateServiceWorker(true)} className="btn btn-accent btn-xs">{t('pwa.update')}</button>
        )}
        <button
          onClick={() => {
            setOfflineReady(false)
            setNeedRefresh(false)
          }}
          className="btn btn-quiet btn-xs"
          aria-label={t('common.close')}
        >
          ✕
        </button>
      </div>
    </div>
  )
}
