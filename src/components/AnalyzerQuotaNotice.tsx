import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useT } from '../i18n/I18nContext'

/** Alerte quand Sonnet est temporairement indisponible; disparition apres reprise. */
export default function AnalyzerQuotaNotice() {
  const t = useT()
  const [retryAt, setRetryAt] = useState<number | null>(null)

  useEffect(() => {
    let active = true
    async function check() {
      const { data } = await supabase
        .from('analyzer_status')
        .select('last_seen, version')
        .order('last_seen', { ascending: false })
        .limit(1)
      if (!active) return
      const status = data?.[0]
      const recent = status?.last_seen && Date.now() - new Date(status.last_seen).getTime() < 120_000
      const match = recent ? status?.version?.match(/claude_paused_until=(\d+)/) : null
      const timestamp = match ? Number(match[1]) * 1000 : 0
      setRetryAt(timestamp > Date.now() ? timestamp : null)
    }
    void check()
    const timer = window.setInterval(() => void check(), 30_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  if (!retryAt) return null
  const minutes = Math.max(1, Math.ceil((retryAt - Date.now()) / 60_000))
  return (
    <div role="status" className="mx-auto mt-3 w-[calc(100%-2rem)] max-w-6xl rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[13px] text-text-soft sm:w-[calc(100%-4rem)]">
      <p className="font-bold">{t('ai.claudeQuotaTitle')}</p>
      <p className="mt-1">{t('ai.claudeQuotaBody', { model: 'GPT-6 Luna', minutes })}</p>
    </div>
  )
}
