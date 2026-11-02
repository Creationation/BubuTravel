import { useEffect, useMemo, useRef, useState } from 'react'
import AppShell from '../components/AppShell'
import Reveal from '../components/Reveal'
import { WalletIcon } from '../components/hub/icons'
import { useAuth } from '../context/AuthContext'
import { usePlaces } from '../context/PlacesContext'
import { useI18n } from '../i18n/I18nContext'
import { compressImage } from '../lib/images'
import { createExpense, fetchExpenses, removeExpense } from '../lib/expenses'
import { errorMessage } from '../lib/errors'
import { runAiJob } from '../lib/aiJobs'
import type { Expense } from '../lib/types'
import { useSearchParams } from 'react-router-dom'

type ReceiptResult = {
  merchant: string
  amount: number | null
  currency: string
  date: string
  category: string
  notes: string
}

const isoLocalInput = (value = new Date()) => {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

async function fileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export default function ExpensesPage() {
  const { t, locale } = useI18n()
  const { user } = useAuth()
  const { trips } = usePlaces()
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<Expense[]>([])
  const [localOnly, setLocalOnly] = useState(false)
  const [merchant, setMerchant] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('EUR')
  const [spentAt, setSpentAt] = useState(isoLocalInput)
  const [category, setCategory] = useState('')
  const [notes, setNotes] = useState('')
  const [params] = useSearchParams()
  const [tripId, setTripId] = useState(() => params.get('voyage') ?? '')
  const [scanning, setScanning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    fetchExpenses(user.id)
      .then(({ rows: loaded, localOnly: local }) => {
        // Les depenses de l'autre voyageur restent dans « Cout du voyage »
        setRows(loaded.filter((r) => r.user_id === user.id))
        setLocalOnly(local)
      })
      .catch((err) => setError(errorMessage(err)))
  }, [user])

  const totals = useMemo(() => {
    const now = new Date()
    const nowMs = now.getTime()
    const startDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const startWeekDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const day = startWeekDate.getDay() || 7
    startWeekDate.setDate(startWeekDate.getDate() - day + 1)
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    const sum = (after: number) => rows
      .filter((row) => new Date(row.spent_at).getTime() >= after)
      .filter((row) => new Date(row.spent_at).getTime() <= nowMs)
      .reduce<Record<string, number>>((all, row) => {
        all[row.currency] = (all[row.currency] ?? 0) + row.amount
        return all
      }, {})
    return { day: sum(startDay), week: sum(startWeekDate.getTime()), month: sum(startMonth) }
  }, [rows])

  const money = (value: number, code = currency) => {
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(value)
    } catch {
      return `${value.toFixed(2)} ${code}`
    }
  }

  async function scan(file: File | undefined) {
    if (!file) return
    setScanning(true)
    setError(null)
    try {
      const { file: image } = await compressImage(file)
      const result = await runAiJob<ReceiptResult>('receipt_scan', {
        image: await fileAsDataUrl(image),
        mime: image.type,
        lang: locale.startsWith('fr') ? 'fr' : 'en',
      }, tripId || null)
      setMerchant(result.merchant || '')
      setAmount(result.amount == null ? '' : String(result.amount))
      setCurrency((result.currency || currency).toUpperCase())
      if (result.date) setSpentAt(`${result.date}T12:00`)
      setCategory(result.category || '')
      setNotes(result.notes || '')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setScanning(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function save() {
    if (!user || !Number.isFinite(Number(amount)) || Number(amount) < 0) return
    setSaving(true)
    setError(null)
    try {
      const result = await createExpense({
        user_id: user.id,
        trip_id: tripId || null,
        merchant: merchant.trim() || t('expenses.unknownMerchant'),
        amount: Number(amount),
        currency: currency.trim().toUpperCase() || 'EUR',
        spent_at: new Date(spentAt).toISOString(),
        category: category.trim() || null,
        notes: notes.trim() || null,
      })
      setRows((prev) => [result.row, ...prev])
      setLocalOnly(result.localOnly)
      setMerchant('')
      setAmount('')
      setCategory('')
      setNotes('')
      setSpentAt(isoLocalInput())
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-5xl px-5 pb-28 sm:px-8">
        <Reveal className="py-10 sm:py-14">
          <p className="eyebrow eyebrow-dot">{t('expenses.eyebrow')}</p>
          <h1 className="display mt-4 text-[clamp(2.4rem,7vw,4.8rem)]">{t('expenses.title')}</h1>
          <p className="lede mt-4 max-w-2xl">{t('expenses.intro')}</p>
        </Reveal>

        {localOnly && <p className="notice mb-5">{t('expenses.localOnly')}</p>}
        {error && <p className="notice notice-bad mb-5">{error}</p>}

        <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="panel p-5 sm:p-7">
            <div className="flex items-center gap-3">
              <span className="glyph h-11 w-11"><WalletIcon size={20} /></span>
              <div>
                <h2 className="display-sm text-2xl">{t('expenses.add')}</h2>
                <p className="text-[12px] text-text-muted">{t('expenses.scanHint')}</p>
              </div>
            </div>

            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void scan(e.target.files?.[0])} />
            <button onClick={() => fileRef.current?.click()} disabled={scanning} className="btn btn-accent mt-5 w-full">
              {scanning ? t('expenses.scanning') : `📷 ${t('expenses.scan')}`}
            </button>

            <div className="mt-5 space-y-3">
              <label><span className="label">{t('expenses.merchant')}</span><input className="field" value={merchant} onChange={(e) => setMerchant(e.target.value)} /></label>
              <div className="grid grid-cols-[1fr_6.5rem] gap-2">
                <label><span className="label">{t('expenses.amount')}</span><input className="field num" type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
                <label><span className="label">{t('expenses.currency')}</span><input className="field uppercase" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value)} /></label>
              </div>
              <label><span className="label">{t('expenses.date')}</span><input className="field num" type="datetime-local" value={spentAt} onChange={(e) => setSpentAt(e.target.value)} /></label>
              {trips.length > 0 && <label><span className="label">{t('expenses.trip')}</span><select className="field" value={tripId} onChange={(e) => setTripId(e.target.value)}><option value="">{t('track.noTrip')}</option>{trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.title}</option>)}</select></label>}
              <label><span className="label">{t('expenses.category')}</span><input className="field" value={category} onChange={(e) => setCategory(e.target.value)} placeholder={t('expenses.categoryHint')} /></label>
              <label><span className="label">{t('common.notes')}</span><textarea className="field min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
              <button onClick={() => void save()} disabled={saving || amount === '' || !spentAt} className="btn btn-accent w-full">{saving ? t('common.saving') : t('expenses.save')}</button>
            </div>
          </section>

          <div className="space-y-5">
            <section className="grid grid-cols-3 gap-2 sm:gap-3">
              {(['day', 'week', 'month'] as const).map((period) => (
                <div key={period} className="card p-3.5 sm:p-5">
                  <p className="eyebrow">{t(`expenses.${period}` as 'expenses.day')}</p>
                  <p className="num mt-2 break-words text-[clamp(0.8rem,3.2vw,1.2rem)] font-extrabold">
                    {Object.keys(totals[period]).length
                      ? Object.entries(totals[period]).map(([code, total]) => money(total, code)).join(' · ')
                      : money(0)}
                  </p>
                </div>
              ))}
            </section>

            <section className="panel overflow-hidden">
              <div className="border-b border-line px-5 py-4"><h2 className="display-sm text-xl">{t('expenses.history')}</h2></div>
              {rows.length === 0 ? <p className="p-6 text-[14px] text-text-muted">{t('expenses.empty')}</p> : (
                <ul>
                  {rows.map((row) => (
                    <li key={row.id} className="flex items-center gap-3 border-b border-line px-4 py-3.5 last:border-0">
                      <span className="glyph h-9 w-9"><WalletIcon size={16} /></span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-semibold">{row.merchant}</span><span className="block truncate text-[11px] text-text-muted">{new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(row.spent_at))}{row.category ? ` · ${row.category}` : ''}</span></span>
                      <span className="num text-[14px] font-bold">{money(row.amount, row.currency)}</span>
                      <button aria-label={t('common.delete')} title={t('common.delete')} onClick={async () => { if (!user) return; await removeExpense(user.id, row.id, localOnly); setRows((prev) => prev.filter((x) => x.id !== row.id)) }} className="btn btn-quiet btn-xs">×</button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
