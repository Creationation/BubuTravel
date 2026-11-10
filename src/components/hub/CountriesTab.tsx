import { useCallback, useEffect, useMemo, useState } from 'react'
import { errorMessage } from '../../lib/errors'
import { addCountry, fetchGuides, flagOf, generateGuide } from '../../lib/countries'
import { useAnalyzerOnline } from '../../lib/ideas'
import { shortDate, todayIso } from '../../lib/tripDates'
import type { CountryGuide, CountryGuideRow, Trip, TripTodo } from '../../lib/types'
import type { TripHub } from '../../lib/useTripHub'
import { useFeedback } from '../../context/FeedbackContext'
import { useI18n } from '../../i18n/I18nContext'
import type { Key } from '../../i18n/fr'
import { CheckIcon, PlusIcon, SparkIcon, TodoKindIcon, TrashIcon, WalletIcon } from './icons'
import { countryName } from '../../lib/countryName'

const PASSPORT_KEY = 'bubutravel:passport'

/**
 * Un onglet par pays du voyage : comment payer (carte, liquide, paiement
 * mobile, distributeurs, pourboires), entree, pratique, et la check-list du
 * pays. En tete, la check-list generale du voyage.
 */
export default function CountriesTab({ trip, hub }: { trip: Trip; hub: TripHub }) {
  const { t } = useI18n()
  const [guides, setGuides] = useState<CountryGuideRow[]>([])
  const [newCountry, setNewCountry] = useState('')
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setGuides(await fetchGuides(trip.id))
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [trip.id])

  useEffect(() => {
    void reload()
  }, [reload])

  // Pays des etapes, dans l'ordre du voyage, puis ceux ajoutes a la main
  const countries = useMemo(() => {
    const list: string[] = []
    for (const s of hub.stops) if (s.country && !list.includes(s.country)) list.push(s.country)
    for (const g of guides) if (!list.includes(g.country)) list.push(g.country)
    return list
  }, [hub.stops, guides])

  return (
    <div className="space-y-8">
      <p className="lede max-w-2xl text-[15px]">{t('country.intro')}</p>
      {error && <p className="notice notice-bad">{error}</p>}

      <Checklist title={t('country.general')} hint={t('country.generalHint')} country={null} hub={hub} />

      {countries.length === 0 && <p className="text-center text-text-muted">{t('country.empty')}</p>}

      {countries.map((country) => (
        <CountryCard
          key={country}
          trip={trip}
          hub={hub}
          country={country}
          row={guides.find((g) => g.country === country) ?? null}
          onSaved={(row) => setGuides((prev) => [...prev.filter((g) => g.country !== row.country), row])}
        />
      ))}

      <form
        onSubmit={async (e) => {
          e.preventDefault()
          const name = newCountry.trim()
          if (!name) return
          try {
            const row = await addCountry(trip.id, name)
            setGuides((prev) => [...prev.filter((g) => g.country !== row.country), row])
            setNewCountry('')
          } catch (err) {
            setError(errorMessage(err))
          }
        }}
        className="flex gap-2"
      >
        <input
          className="field max-w-xs"
          value={newCountry}
          onChange={(e) => setNewCountry(e.target.value)}
          placeholder={t('country.addPlaceholder')}
        />
        <button type="submit" className="btn" disabled={!newCountry.trim()}>
          <PlusIcon size={15} />
          {t('country.add')}
        </button>
      </form>
    </div>
  )
}

function CountryCard({
  trip,
  hub,
  country,
  row,
  onSaved,
}: {
  trip: Trip
  hub: TripHub
  country: string
  row: CountryGuideRow | null
  onSaved: (row: CountryGuideRow) => void
}) {
  const { t, lang, locale } = useI18n()
  const online = useAnalyzerOnline()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(true)
  const [passport, setPassport] = useState(() => {
    try {
      return window.localStorage.getItem(PASSPORT_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const guide = row?.guide ?? null

  async function generate() {
    setBusy(true)
    setError(null)
    try {
      try {
        window.localStorage.setItem(PASSPORT_KEY, passport)
      } catch {
        // sans importance
      }
      const saved = await generateGuide(trip.id, {
        country,
        lang,
        passport: passport.trim(),
        start_date: trip.start_date,
        end_date: trip.end_date,
        stops: hub.stops
          .filter((s) => s.country === country)
          .map((s) => `${s.name} (${s.arrive_date ?? '?'} -> ${s.leave_date ?? '?'})`),
        today: todayIso(),
      })
      onSaved(saved)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4 sm:px-6">
        <button onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="text-3xl leading-none">{flagOf(country)}</span>
          <span className="min-w-0">
            <span className="display-sm block truncate text-2xl">{countryName(country)}</span>
            {guide && (
              <span className="num block text-[12px] text-text-muted">
                {guide.currency.code} · {guide.currency.rate_hint.split(/[.(;]/)[0].trim()}
              </span>
            )}
          </span>
        </button>
        <button onClick={generate} disabled={busy} className={`btn btn-xs ${guide ? 'btn-quiet' : 'btn-accent'}`}>
          <SparkIcon size={13} />
          {busy ? t('common.wait') : guide ? t('country.regenerate') : t('country.generate')}
        </button>
      </header>

      {open && (
        <div className="space-y-6 p-5 sm:p-6">
          {!guide && !busy && (
            <div className="space-y-3">
              <p className="text-[14px] text-text-muted">{t('country.noGuide')}</p>
              <div className="max-w-sm">
                <label className="label">{t('country.passport')}</label>
                <input
                  className="field"
                  value={passport}
                  onChange={(e) => setPassport(e.target.value)}
                  placeholder={t('country.passportPlaceholder')}
                />
              </div>
              {online === false && <p className="chip chip-warn">{t('ai.pcOffline')}</p>}
            </div>
          )}
          {busy && (
            <div className="card-feature flex items-center gap-3 p-4">
              <span className="glyph animate-pulse">
                <SparkIcon size={17} />
              </span>
              <p className="text-[14px] text-text-soft">{t('country.generating')}</p>
            </div>
          )}
          {error && <p className="notice notice-bad">{error}</p>}

          {guide && <GuideView guide={guide} />}

          <Checklist
            title={`${t('country.checklist')} · ${countryName(country)}`}
            country={country}
            hub={hub}
            suggestions={guide?.checklist ?? []}
          />

          {guide && row && (
            <p className="text-[11px] text-text-muted">
              {t('country.updated', { date: shortDate(row.updated_at.slice(0, 10), locale) })} · {t('country.verify')}
            </p>
          )}
        </div>
      )}
    </section>
  )
}

function GuideView({ guide }: { guide: CountryGuide }) {
  const { t } = useI18n()
  const p = guide.payments
  return (
    <div className="space-y-6">
      {/* Paiement : la partie la plus consultee, mise en avant */}
      <div className="card-feature p-5">
        <p className="eyebrow eyebrow-dot">
          <WalletIcon size={13} />
          {t('country.payments')}
        </p>
        <p className="mt-3 text-[15px] leading-relaxed">{p.summary}</p>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <Item label={t('country.currency')} value={`${guide.currency.name} (${guide.currency.code}) · ${guide.currency.rate_hint}`} />
          <Item label={t('country.cards')} value={p.cards} />
          <Item label={t('country.cash')} value={p.cash} />
          <Item label={t('country.mobile')} value={p.mobile} />
          <Item label={t('country.atm')} value={p.atm} />
          <Item label={t('country.tipping')} value={p.tipping} />
        </dl>
        {p.tips.length > 0 && <Bullets title={t('country.moneyTips')} items={p.tips} />}
      </div>

      <div>
        <p className="eyebrow mb-3">{t('country.practical')}</p>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Item label={t('country.entry')} value={guide.entry} />
          <Item label={t('country.plugs')} value={guide.plugs} />
          <Item label={t('country.sim')} value={guide.sim} />
          <Item label={t('country.emergency')} value={guide.emergency} />
        </dl>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {guide.safety.length > 0 && <Bullets title={t('country.safety')} items={guide.safety} />}
          {guide.etiquette.length > 0 && <Bullets title={t('country.etiquette')} items={guide.etiquette} />}
        </div>
      </div>
    </div>
  )
}

function Item({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">{label}</dt>
      <dd className="mt-1 text-[14px] leading-relaxed text-text-soft">{value}</dd>
    </div>
  )
}

function Bullets({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">{title}</p>
      <ul className="mt-2 space-y-1.5 text-[14px] text-text-soft">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="text-accent">•</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Check-list d'un pays (ou generale si country = null). Ce sont les « a
 * faire » du voyage : ils apparaissent aussi dans l'onglet A faire et dans
 * l'agenda s'ils ont une date.
 */
function Checklist({
  title,
  hint,
  country,
  hub,
  suggestions = [],
}: {
  title: string
  hint?: string
  country: string | null
  hub: TripHub
  suggestions?: CountryGuide['checklist']
}) {
  const { t } = useI18n()
  const fb = useFeedback()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const items = hub.todos.filter((x) => (x.country ?? null) === country)
  const done = items.filter((x) => x.done).length
  const existing = new Set(items.map((x) => x.title.trim().toLowerCase()))
  const missing = suggestions.filter((s) => !existing.has(s.title.trim().toLowerCase()))

  async function add(title: string, extra: Partial<TripTodo> = {}) {
    setError(null)
    try {
      await hub.addTodo({ title, country, kind: 'todo', ...extra })
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-[15px] font-semibold">{title}</p>
          {hint && <p className="text-[12px] text-text-muted">{hint}</p>}
        </div>
        {items.length > 0 && (
          <span className="num chip chip-accent">
            {done}/{items.length}
          </span>
        )}
      </div>

      {items.length > 0 && (
        <ul className="mt-3 divide-y divide-line">
          {items
            .sort((a, b) => Number(a.done) - Number(b.done) || a.position - b.position)
            .map((item) => (
              <li key={item.id} className="group flex items-center gap-3 py-2.5">
                <button
                  onClick={() => void hub.editTodo(item.id, { done: !item.done })}
                  className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border ${
                    item.done ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong'
                  }`}
                  aria-label={item.done ? t('planner.uncheck') : t('planner.check')}
                >
                  {item.done && <CheckIcon size={13} />}
                </button>
                <span className={`min-w-0 flex-1 text-[14px] ${item.done ? 'text-text-muted line-through' : ''}`}>
                  {item.title}
                </span>
                <button
                  onClick={() => void fb.confirmDelete({ title: t('fb.delTodoTitle'), subject: item.title, done: t('fb.todoDeleted'), run: () => hub.removeTodo(item.id) })}
                  className="btn btn-quiet btn-icon opacity-50 group-hover:opacity-100"
                  aria-label={t('common.remove')}
                >
                  <TrashIcon size={14} />
                </button>
              </li>
            ))}
        </ul>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!text.trim()) return
          void add(text.trim())
          setText('')
        }}
        className="mt-3 flex gap-2"
      >
        <input
          className="field py-2 text-[14px]"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('todo.placeholder')}
        />
        <button type="submit" className="btn btn-xs" disabled={!text.trim()}>
          <PlusIcon size={14} />
        </button>
      </form>

      {missing.length > 0 && (
        <div className="mt-4 rounded-2xl border border-dashed border-line-strong p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">{t('country.suggested')}</p>
            <button
              onClick={async () => {
                for (const s of missing) await add(s.title, { kind: s.kind, notes: s.notes || null })
              }}
              className="btn btn-xs btn-accent"
            >
              {t('country.addAll')}
            </button>
          </div>
          <ul className="mt-2 space-y-1.5">
            {missing.map((s) => (
              <li key={s.title} className="flex items-center gap-2.5 text-[13px]">
                <span className="text-text-muted">
                  <TodoKindIcon kind={s.kind} size={13} />
                </span>
                <span className="min-w-0 flex-1">
                  {s.title}
                  <span className="text-text-muted"> · {t(`country.when.${s.when}` as Key)}</span>
                </span>
                <button
                  onClick={() => void add(s.title, { kind: s.kind, notes: s.notes || null })}
                  className="btn btn-quiet btn-icon"
                  aria-label={t('common.add')}
                >
                  <PlusIcon size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="notice notice-bad mt-3">{error}</p>}
    </div>
  )
}
