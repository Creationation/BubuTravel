import { useI18n } from './I18nContext'
import { Flag } from './flags'
import type { Lang } from '../lib/types'

const LANGS: { value: Lang; label: string }[] = [
  { value: 'fr', label: 'Francais' },
  { value: 'en', label: 'English' },
]

/**
 * Choix de la langue par drapeau. Le libelle reste dans sa propre langue :
 * « Francais » et « English », jamais traduits, c'est la convention qui evite
 * l'effet miroir ou l'on cherche sa langue dans une langue qu'on ne lit pas.
 */
export default function LanguageSwitch({ compact = false }: { compact?: boolean }) {
  const { lang, setLang } = useI18n()

  return (
    <div className={`flex gap-2 ${compact ? '' : 'flex-wrap'}`}>
      {LANGS.map((item) => {
        const active = lang === item.value
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => setLang(item.value)}
            aria-pressed={active}
            title={item.label}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 transition-colors ${
              active
                ? 'border-accent bg-[var(--halo)] text-accent'
                : 'border-line text-text-soft hover:border-line-strong'
            }`}
          >
            <span className="overflow-hidden rounded-[3px] border border-line-strong/60 leading-none">
              <Flag lang={item.value} size={compact ? 20 : 24} />
            </span>
            {!compact && <span className="text-[13px] font-medium">{item.label}</span>}
          </button>
        )
      })}
    </div>
  )
}
