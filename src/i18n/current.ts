/**
 * Langue courante, lisible hors des composants (fonctions de lib, messages
 * d'erreur, formats de date et de nombre). I18nProvider la tient a jour.
 */
import { fr } from './fr'
import type { Key } from './fr'
import { en } from './en'
import type { Lang } from '../lib/types'

let lang: Lang = 'fr'

export function setCurrentLang(next: Lang) {
  lang = next
}

export function currentLang(): Lang {
  return lang
}

export function currentLocale(): string {
  return lang === 'fr' ? 'fr-FR' : 'en-GB'
}

/** Traduction hors React. */
export function tr(key: Key, params?: Record<string, string | number>): string {
  const raw = (lang === 'en' ? en[key] : fr[key]) ?? fr[key] ?? key
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m))
}

/** Nombre a virgule ou a point selon la langue. */
export function fmtNum(n: number, digits = 0): string {
  return n.toLocaleString(currentLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits })
}
