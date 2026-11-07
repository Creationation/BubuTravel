import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '../i18n/I18nContext'
import TicketsSheet from './TicketsSheet'

/**
 * Acces rapide pendant le voyage : les quatre choses qu'on cherche le plus,
 * en un seul toucher et sans menu : billets, ou l'on dort, urgences, depense.
 */
export default function QuickBar({ tripId, className = '' }: { tripId: string; className?: string }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [tickets, setTickets] = useState(false)
  const items: { icon: string; label: string; run: () => void }[] = [
    { icon: '🎟️', label: t('qb.tickets'), run: () => setTickets(true) },
    { icon: '🏨', label: t('qb.stay'), run: () => navigate('/hebergements') },
    { icon: '🆘', label: t('qb.sos'), run: () => navigate('/coffre') },
    { icon: '💳', label: t('qb.expense'), run: () => navigate(`/depenses?voyage=${tripId}`) },
  ]
  return (
    <>
      <div className={`grid grid-cols-4 gap-2.5 ${className}`}>
        {items.map((i) => (
          <button
            key={i.label}
            onClick={i.run}
            className="flex flex-col items-center gap-1.5 rounded-[20px] border border-line bg-surface-solid px-1 py-3 shadow-[var(--shadow-sm)] transition-transform active:scale-95"
          >
            <span className="text-[1.7rem] leading-none">{i.icon}</span>
            <span className="text-[11.5px] font-extrabold leading-tight">{i.label}</span>
          </button>
        ))}
      </div>
      {tickets && <TicketsSheet onClose={() => setTickets(false)} />}
    </>
  )
}
