import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadTickets, ticketImages } from '../lib/tickets'
import type { Ticket } from '../lib/tickets'
import { shortDate, todayIso } from '../lib/tripDates'
import { useI18n } from '../i18n/I18nContext'
import Lightbox from './Lightbox'
import Portal from './Portal'

/** Ouvre un billet en plein ecran (QR sur fond blanc, a glisser s'il y a plusieurs pages). */
export function useTicketViewer() {
  const [viewer, setViewer] = useState<{ urls: string[]; index: number; title: string } | null>(null)
  const [busy, setBusy] = useState(false)
  async function open(t: Ticket) {
    setBusy(true)
    try {
      const urls = await ticketImages(t)
      if (urls.length) setViewer({ urls, index: 0, title: t.title })
    } finally {
      setBusy(false)
    }
  }
  const node = viewer ? (
    <Lightbox urls={viewer.urls} index={viewer.index} onIndexChange={(i) => setViewer((v) => (v ? { ...v, index: i } : v))} onClose={() => setViewer(null)} caption={viewer.title} light />
  ) : null
  return { open, node, busy }
}

/**
 * Mes billets : tous les billets (festival, vol, reservation) en un coup
 * d'oeil, les prochains d'abord. Un toucher ouvre le QR en plein ecran.
 */
export default function TicketsSheet({ onClose }: { onClose: () => void }) {
  const { t, locale } = useI18n()
  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const viewer = useTicketViewer()

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    loadTickets()
      .then(setTickets)
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e))
        setTickets([])
      })
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  const today = todayIso()
  const sorted = [...(tickets ?? [])].sort((a, b) => Number(b.to >= today) - Number(a.to >= today) || a.from.localeCompare(b.from))

  return (
    <Portal>
      <div className="fixed inset-0 z-[2600] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
        <div className="absolute inset-0 bg-[#120d09]/60" onClick={onClose} />
        <div className="sheet-in relative flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] bg-surface-solid shadow-[var(--shadow-lg)] sm:rounded-[28px]">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
            <p className="text-[1.2rem] font-extrabold">🎟️ {t('tk.title')}</p>
            <button onClick={onClose} className="btn btn-quiet btn-xs">
              {t('common.close')}
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 py-4">
            {tickets === null && <p className="py-8 text-center text-text-muted">{t('common.loading')}</p>}
            {error && <p className="notice notice-bad">{error}</p>}
            {tickets?.length === 0 && !error && <p className="py-8 text-center text-[14px] text-text-muted">{t('tk.empty')}</p>}
            {sorted.map((tk) => {
              const past = tk.to < today
              const range = tk.from === tk.to ? shortDate(tk.from, locale, true) : `${shortDate(tk.from, locale)} → ${shortDate(tk.to, locale)}`
              return (
                <button
                  key={tk.id}
                  onClick={() => void viewer.open(tk)}
                  disabled={tk.files.length === 0}
                  className={`flex w-full items-center gap-3.5 rounded-[22px] border border-line bg-surface p-4 text-left shadow-[var(--shadow-sm)] transition-transform active:scale-[0.98] ${past ? 'opacity-60' : ''}`}
                >
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[var(--halo)] text-3xl">🎟️</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15.5px] font-extrabold leading-snug">{tk.title}</span>
                    <span className="num mt-0.5 block text-[12.5px] capitalize text-text-muted">{range}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-accent px-3 py-1.5 text-[12px] font-extrabold text-accent-ink">{viewer.busy ? '…' : t('tk.show')}</span>
                </button>
              )
            })}
          </div>
          <div className="border-t border-line p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <Link to="/coffre" onClick={onClose} className="btn w-full">
              🔐 {t('tk.vault')}
            </Link>
          </div>
        </div>
      </div>
      {viewer.node}
    </Portal>
  )
}
