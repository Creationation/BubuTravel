import { fetchVault, vaultFileUrls } from './vault'
import type { VaultItem } from './vault'
import { addDaysIso } from './tripDates'

/**
 * Billets : les elements « billet » du coffre (festival, vol, reservation),
 * avec leurs dates lues dans les notes (« 18 au 20 dec. 2026 ») pour les
 * placer dans l'agenda, et leurs fichiers (QR codes) pour un acces direct.
 */
export type Ticket = {
  id: string
  title: string
  holder: string | null
  number: string | null
  from: string
  to: string
  files: string[]
  notes: string | null
  url: string | null
  item: VaultItem
}

const MONTHS: [RegExp, number][] = [
  [/^janv?/, 1], [/^fev/, 2], [/^feb/, 2], [/^mar/, 3], [/^avr/, 4], [/^apr/, 4], [/^mai/, 5], [/^may/, 5],
  [/^juin/, 6], [/^jun/, 6], [/^juil/, 7], [/^jul/, 7], [/^aou/, 8], [/^aug/, 8], [/^sep/, 9], [/^oct/, 10], [/^nov/, 11], [/^dec/, 12],
]

function monthOf(word: string): number | null {
  const w = word.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  for (const [re, n] of MONTHS) if (re.test(w)) return n
  return null
}

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/** Jours de l'evenement : plage « 18 au 20 dec. 2026 », date seule, ou la date d'expiration. */
export function ticketDays(notes: string | null, expires: string | null): { from: string; to: string } | null {
  const text = notes ?? ''
  const range = text.match(/(\d{1,2})\s*(?:au|–|-|to)\s*(\d{1,2})\s+([A-Za-zÀ-ÿ]{3,})\.?\s*(\d{4})/)
  if (range) {
    const m = monthOf(range[3])
    if (m) return { from: iso(Number(range[4]), m, Number(range[1])), to: iso(Number(range[4]), m, Number(range[2])) }
  }
  const single = text.match(/(\d{1,2})\s+([A-Za-zÀ-ÿ]{3,})\.?\s*(\d{4})/)
  if (single) {
    const m = monthOf(single[2])
    if (m) {
      const d = iso(Number(single[3]), m, Number(single[1]))
      return { from: d, to: d }
    }
  }
  return expires ? { from: expires, to: expires } : null
}

/** Confirmations de commande, recus, factures : des infos, pas des billets a presenter. */
export const isConfirmation = (title: string) => /confirmation|commande|order|re[cç]u|receipt|facture|invoice|paiement|payment/i.test(title)

/** Billets a presenter (avec fichier, hors confirmations). `all` : tout, pour la page Evenements. */
export async function loadTickets(all = false): Promise<Ticket[]> {
  const items = await fetchVault()
  const out: Ticket[] = []
  for (const it of items) {
    if (it.kind !== 'ticket') continue
    if (!all && (it.files.length === 0 || isConfirmation(it.title))) continue
    const days = ticketDays(it.notes, it.expires)
    if (!days) continue
    out.push({ id: it.id, title: it.title, holder: it.holder, number: it.number, from: days.from, to: days.to, files: it.files, notes: it.notes, url: it.url, item: it })
  }
  return out.sort((a, b) => a.from.localeCompare(b.from))
}

/** Chaque jour couvert par un billet (au plus 10). */
export function eachTicketDay(t: Ticket): string[] {
  const days: string[] = []
  for (let d = t.from; d <= t.to && days.length < 10; d = addDaysIso(d, 1)) days.push(d)
  // Un festival de 3 jours se voit chaque jour ; une reservation de 6 nuits seulement le premier
  return days.length > 4 ? days.slice(0, 1) : days
}

export async function ticketImages(t: Ticket): Promise<string[]> {
  const urls = await vaultFileUrls(t.files)
  return t.files.map((f) => urls[f]).filter(Boolean)
}
