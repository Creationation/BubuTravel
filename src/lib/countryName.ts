import { countryKey } from './worldCountries'
import { currentLang } from '../i18n/current'

/**
 * Les pays sont enregistres en francais (« Thaïlande »). A l'affichage, on
 * les montre dans la langue de l'utilisateur, via le code ISO.
 */
let codes: Map<string, string> | null = null

function codeMap(): Map<string, string> {
  if (codes) return codes
  codes = new Map()
  try {
    const names = [new Intl.DisplayNames(['fr'], { type: 'region' }), new Intl.DisplayNames(['en'], { type: 'region' })]
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    for (const a of A)
      for (const b of A) {
        const code = a + b
        for (const dn of names) {
          try {
            const n = dn.of(code)
            if (n && n !== code && !codes.has(countryKey(n))) codes.set(countryKey(n), code)
          } catch {
            // code inexistant
          }
        }
      }
  } catch {
    // Intl.DisplayNames absent : on garde les noms tels quels
  }
  return codes
}

const display = new Map<string, Intl.DisplayNames>()

/** Nom du pays dans la langue courante (ou tel quel si inconnu). */
export function countryName(raw: string | null | undefined): string {
  if (!raw) return ''
  const lang = currentLang()
  if (lang === 'fr') return raw
  const code = codeMap().get(countryKey(raw))
  if (!code) return raw
  try {
    if (!display.has(lang)) display.set(lang, new Intl.DisplayNames([lang], { type: 'region' }))
    return display.get(lang)!.of(code) ?? raw
  } catch {
    return raw
  }
}

/** Categories proposees par defaut : affichees dans la langue courante. */
const CATEGORY_EN: Record<string, string> = {
  ville: 'City',
  nature: 'Nature',
  plage: 'Beach',
  musee: 'Museum',
  restaurant: 'Restaurant',
  hebergement: 'Accommodation',
}

export function categoryLabel(name: string | null | undefined): string {
  if (!name) return ''
  if (currentLang() === 'fr') return name
  return CATEGORY_EN[countryKey(name)] ?? name
}

/** Code ISO d'un pays quel que soit son ecriture (« Thaïlande », « Thailand »...). */
export function countryCode(raw: string | null | undefined): string {
  if (!raw) return ''
  return codeMap().get(countryKey(raw)) ?? ''
}
