import { useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

/**
 * Mises a jour automatiques, comme une app native : des qu'une nouvelle
 * version est en ligne (un push sur GitHub, Vercel redeploie), l'app la
 * prend toute seule. Elle verifie au lancement, au retour sur l'app et
 * toutes les 5 minutes, puis recharge des que la nouvelle version est prete.
 * Rien a reinstaller, aucun bouton a toucher.
 */
export default function UpdatePrompt() {
  const { updateServiceWorker } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (!registration) return
      const check = () => {
        // Apres un court delai : au retour sur l'app, rien ne doit ralentir l'affichage
        if (navigator.onLine) window.setTimeout(() => void registration.update(), 4000)
      }
      window.setInterval(check, 5 * 60 * 1000)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
      window.addEventListener('focus', check)
    },
    onNeedRefresh() {
      // Nouvelle version prete : on l'active et la page se recharge seule
      void updateServiceWorker(true)
    },
  })

  // Le nouveau service worker prend la main : on recharge une fois
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    let reloaded = false
    const onChange = () => {
      if (reloaded) return
      reloaded = true
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onChange)
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onChange)
  }, [])

  return null
}
