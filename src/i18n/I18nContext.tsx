import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from '../context/AuthContext'
import { updateLang } from '../lib/api'
import type { Lang } from '../lib/types'
import { fr } from './fr'
import type { Key } from './fr'
import { en } from './en'

const DICTS = { fr, en }
const STORAGE_KEY = 'bubutravel:lang'

type I18nValue = {
  lang: Lang
  /** Etiquette BCP 47, pour les dates et les nombres. */
  locale: string
  t: (key: Key, params?: Record<string, string | number>) => string
  setLang: (lang: Lang) => void
}

const I18nContext = createContext<I18nValue | null>(null)

/** Avant la connexion : dernier choix, sinon la langue du navigateur. */
function guessLang(): Lang {
  if (typeof window === 'undefined') return 'fr'
  const saved = window.localStorage.getItem(STORAGE_KEY)
  if (saved === 'fr' || saved === 'en') return saved
  return navigator.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en'
}

/**
 * La langue est liee au compte, pas a l'appareil : elle suit l'utilisateur du
 * telephone a l'ordinateur. Tant que personne n'est connecte, on se rabat sur
 * le dernier choix local, ce qui permet de traduire l'ecran de connexion.
 *
 * Ce fournisseur doit etre place SOUS AuthProvider, puisqu'il lit le profil.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const { user, profile, refreshProfile } = useAuth()
  const [lang, setLangState] = useState<Lang>(guessLang)

  // Le profil fait autorite des qu'il est charge
  useEffect(() => {
    if (profile?.lang && profile.lang !== lang) setLangState(profile.lang)
    // lang volontairement absent : on ne veut suivre que le profil ici
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.lang])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, lang)
    document.documentElement.lang = lang
  }, [lang])

  const setLang = useCallback(
    (next: Lang) => {
      setLangState(next)
      if (!user) return
      // L'ecriture en base ne doit pas bloquer le changement a l'ecran
      void updateLang(user.id, next)
        .then(() => refreshProfile())
        .catch((err) => console.error('[i18n] langue non enregistree', err))
    },
    [user, refreshProfile],
  )

  const value = useMemo<I18nValue>(() => {
    const dict = DICTS[lang]
    return {
      lang,
      locale: lang === 'fr' ? 'fr-FR' : 'en-GB',
      setLang,
      t(key, params) {
        const raw = dict[key] ?? fr[key] ?? key
        if (!params) return raw
        // Remplacement simple : {nom} devient la valeur passee
        return raw.replace(/\{(\w+)\}/g, (match, name: string) =>
          name in params ? String(params[name]) : match,
        )
      },
    }
  }, [lang, setLang])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n doit etre utilise dans I18nProvider')
  return ctx
}

/** Raccourci pour les composants qui n'ont besoin que de traduire. */
// eslint-disable-next-line react-refresh/only-export-components
export function useT() {
  return useI18n().t
}
