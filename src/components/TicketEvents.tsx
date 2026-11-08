import { useEffect, useState } from 'react'
import { loadTickets } from '../lib/tickets'
import type { Ticket } from '../lib/tickets'
import { shortDate, todayIso } from '../lib/tripDates'
import { useI18n } from '../i18n/I18nContext'
import { useTicketViewer } from './TicketsSheet'

/**
 * Billets et reservations, avec toutes leurs informations (reference,
 * confirmation de commande, notes, lien). Le QR seul reste dans « Mes billets ».
 */
export default function TicketEvents() {
  const { t, locale } = useI18n()
  const [list, setList] = useState<Ticket[] | null>(null)
  const viewer = useTicketViewer()

  useEffect(() => {
    loadTickets(true).then(setList).catch(() => setList([]))
  }, [])

  if (!list || list.length === 0) return null
  const today = todayIso()
  const sorted = [...list].sort((a, b) => Number(b.to >= today) - Number(a.to >= today) || a.from.localeCompare(b.from))

  return (
    <section className="mt-10">
      <p className="eyebrow mb-4">🎟️ {t('tk.events')}</p>
      <ul className="space-y-3">
        {sorted.map((tk) => {
          const range = tk.from === tk.to ? shortDate(tk.from, locale, true) : `${shortDate(tk.from, locale)} → ${shortDate(tk.to, locale)}`
          return (
            <li key={tk.id} className={`rounded-[22px] border border-line bg-surface p-4 shadow-[var(--shadow-sm)] ${tk.to < today ? 'opacity-60' : ''}`}>
              <p className="text-[15.5px] font-extrabold leading-snug">{tk.title}</p>
              <p className="num mt-0.5 text-[12.5px] capitalize text-text-muted">{range}</p>
              {tk.holder && <p className="text-[12.5px] text-text-muted">👤 {tk.holder}</p>}
              {tk.number && <p className="num font-mono text-[12.5px] text-text-muted">{tk.number}</p>}
              {tk.notes && <p className="mt-2 whitespace-pre-line text-[13px] leading-snug text-text-soft">{tk.notes}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {tk.files.length > 0 && (
                  <button onClick={() => void viewer.open(tk)} className="btn btn-accent btn-xs">
                    {viewer.busy ? '…' : `🎟️ ${t('tk.show')}`}
                  </button>
                )}
                {tk.url && (
                  <a href={tk.url} target="_blank" rel="noreferrer" className="btn btn-xs">
                    🔗 {t('gap.open')}
                  </a>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {viewer.node}
    </section>
  )
}
