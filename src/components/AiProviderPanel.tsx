import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { useI18n } from '../i18n/I18nContext'
import type { Key } from '../i18n/fr'

type Provider = 'auto' | 'claude' | 'chatgpt'

const OPTIONS: { id: Provider; emoji: string; title: Key; hint: Key }[] = [
  { id: 'auto', emoji: '🔀', title: 'aip.auto', hint: 'aip.autoHint' },
  { id: 'claude', emoji: '🟠', title: 'aip.claude', hint: 'aip.claudeHint' },
  { id: 'chatgpt', emoji: '🟢', title: 'aip.chatgpt', hint: 'aip.chatgptHint' },
]

/**
 * Quel moteur fait les recherches IA (fiches, plan du jour, assistant,
 * tickets) : Claude Code, ChatGPT, ou automatique (Claude, avec ChatGPT en
 * secours quand sa limite est atteinte). S'applique a la prochaine demande.
 */
export default function AiProviderPanel() {
  const { t } = useI18n()
  const { user, profile, refreshProfile } = useAuth()
  const current = ((profile as { ai_provider?: Provider } | null)?.ai_provider ?? 'auto') as Provider
  const [busy, setBusy] = useState<Provider | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function choose(id: Provider) {
    if (!user || id === current) return
    setBusy(id)
    setError(null)
    const { error: err } = await supabase.from('profiles').update({ ai_provider: id } as never).eq('id', user.id)
    if (err) setError(err.message)
    else await refreshProfile()
    setBusy(null)
  }

  return (
    <section className="panel p-6 sm:p-8">
      <h2 className="display-sm text-2xl">🤖 {t('aip.title')}</h2>
      <p className="lede mt-2 text-[14px]">{t('aip.intro')}</p>
      <div className="mt-5 space-y-2.5" role="radiogroup" aria-label={t('aip.title')}>
        {OPTIONS.map((o) => {
          const active = current === o.id
          return (
            <button
              key={o.id}
              role="radio"
              aria-checked={active}
              onClick={() => void choose(o.id)}
              disabled={busy !== null}
              className={`flex w-full items-center gap-3.5 rounded-2xl border p-3.5 text-left transition-all duration-300 active:scale-[0.98] ${
                active ? 'border-accent bg-[var(--halo)] shadow-[var(--shadow-sm)]' : 'border-line bg-surface'
              }`}
            >
              <span className="text-2xl">{o.emoji}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-extrabold">{t(o.title)}</span>
                <span className="block text-[12.5px] leading-snug text-text-muted">{t(o.hint)}</span>
              </span>
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                  active ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong'
                }`}
              >
                {busy === o.id ? <span className="ai-spin inline-block text-[11px]">✨</span> : active ? '✓' : ''}
              </span>
            </button>
          )
        })}
      </div>
      <p className="mt-3 text-[12px] text-text-muted">{t('aip.note')}</p>
      {error && <p className="notice notice-bad mt-3">{error}</p>}
    </section>
  )
}
