import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAiJobs } from '../../context/AiJobsContext'
import { useAuth } from '../../context/AuthContext'
import { errorMessage } from '../../lib/errors'
import { supabase } from '../../lib/supabase'
import type { Trip, TripVaccine, VaccineEntry, VaccineStatus } from '../../lib/types'
import type { TripHub } from '../../lib/useTripHub'
import { useI18n } from '../../i18n/I18nContext'
import { countryName } from '../../lib/countryName'
import AiGauge from '../AiGauge'
import { flagOf } from '../../lib/countries'

const db = () => supabase as unknown as { from: (t: string) => ReturnType<typeof supabase.from> }
const STATUSES: VaccineStatus[] = ['todo', 'taken', 'already', 'skip']
const DECIDED: VaccineStatus[] = ['taken', 'already', 'skip']

/** Pays ou l'on dort, dans l'ordre du voyage. */
export function tripCountries(hub: TripHub): string[] {
  const list: string[] = []
  for (const s of hub.stops) if (s.country && !list.includes(s.country)) list.push(s.country)
  return list
}

/**
 * Lance tout seul la recherche des vaccins pour chaque pays du voyage qui
 * n'en a pas encore (une seule fois par pays). Utilise a l'ouverture du voyage.
 */
export function useVaccineAutoQueue(trip: Trip | undefined, hub: TripHub) {
  const { queue } = useAiJobs()
  const { lang } = useI18n()
  const countries = tripCountries(hub).join('|')
  useEffect(() => {
    if (!trip || !countries) return
    let cancelled = false
    void (async () => {
      const [{ data: have }, { data: asked }] = await Promise.all([
        db().from('trip_vaccines').select('country').eq('trip_id', trip.id),
        db().from('ai_jobs').select('input, status, kind').eq('trip_id', trip.id).in('kind', ['vaccines', 'emergency']),
      ])
      const known = new Set([
        ...((have ?? []) as unknown as { country: string }[]).map((r) => `vaccines:${r.country.toLowerCase()}`),
        ...((asked ?? []) as unknown as { input: { country?: string }; status: string; kind: string }[])
          .filter((r) => r.status !== 'error')
          .map((r) => `${r.kind}:${(r.input?.country ?? '').toLowerCase()}`),
      ])
      for (const country of countries.split('|')) {
        for (const kind of ['vaccines', 'emergency']) {
          const key = `${kind}:${country.toLowerCase()}`
          if (cancelled || known.has(key)) continue
          known.add(key)
          await queue(kind, { country, lang }, trip.id).catch(() => undefined)
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id, countries])
}

/**
 * Vaccins du voyage : l'IA propose, par pays, ce qui est exige ou conseille ;
 * chacun de vous deux decide (a prendre, pris, deja pris, non) et note le prix
 * reel, qui part dans « Cout du voyage ». Les vaccins a faire sont aussi dans
 * les choses a faire, urgents si le delai est court.
 */
export default function VaccinesTab({ trip, hub }: { trip: Trip; hub: TripHub }) {
  const { t, lang } = useI18n()
  const { user } = useAuth()
  const { queue, jobs } = useAiJobs()
  const [rows, setRows] = useState<TripVaccine[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [costDraft, setCostDraft] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    const { data, error: err } = await db().from('trip_vaccines').select('*').eq('trip_id', trip.id).order('created_at')
    if (err) setError(errorMessage(err))
    else setRows((data ?? []) as unknown as TripVaccine[])
    setLoading(false)
  }, [trip.id])

  useEffect(() => {
    void load()
  }, [load])

  // Une recherche se termine : on recharge la liste
  const readyKey = jobs.filter((j) => j.kind === 'vaccines' && j.status === 'ready').map((j) => j.id).join(',')
  useEffect(() => {
    if (readyKey) void load()
  }, [readyKey, load])

  const countries = useMemo(() => {
    const list = tripCountries(hub)
    for (const r of rows) if (!list.includes(r.country)) list.push(r.country)
    return list
  }, [hub, rows])

  const people = hub.people
  const entryOf = (v: TripVaccine, uid: string): VaccineEntry => v.entries?.[uid] ?? { status: 'todo' }

  const money = (n: number, cur = 'EUR') => {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(n)
    } catch {
      return `${n} ${cur}`
    }
  }

  // Totaux : ce qui a ete depense, et ce qui reste estime
  const totals = useMemo(() => {
    const spent = new Map<string, number>()
    let estimated = 0
    for (const v of rows) {
      for (const p of people) {
        const e = v.entries?.[p.user_id]
        if (e?.status === 'taken' && e.cost) spent.set(e.currency ?? 'EUR', (spent.get(e.currency ?? 'EUR') ?? 0) + e.cost)
        if ((!e || e.status === 'todo') && v.est_price && v.level !== 'consider') estimated += v.est_price
      }
    }
    return { spent: [...spent.entries()], estimated }
  }, [rows, people])

  async function syncTodo(v: TripVaccine, entries: Record<string, VaccineEntry>) {
    if (!v.todo_id) return
    const all = people.length > 0 && people.every((p) => DECIDED.includes(entries[p.user_id]?.status ?? 'todo'))
    await db().from('trip_todos').update({ done: all, done_by: all ? user?.id ?? null : null } as never).eq('id', v.todo_id)
  }

  async function setEntry(v: TripVaccine, uid: string, patch: Partial<VaccineEntry>) {
    if (!user) return
    setError(null)
    try {
      const current = entryOf(v, uid)
      let next: VaccineEntry = { ...current, ...patch }
      const person = people.find((p) => p.user_id === uid)?.display_name ?? ''
      // Le prix n'existe que pour un vaccin « pris » : sinon la depense est retiree
      if (next.status !== 'taken' && next.expense_id) {
        await db().from('expenses').delete().eq('id', next.expense_id)
        next = { ...next, expense_id: undefined, cost: undefined }
      }
      if (next.status === 'taken' && next.cost && next.cost > 0) {
        const row = {
          merchant: `${v.name} · ${person}`.slice(0, 120), amount: next.cost, currency: next.currency ?? 'EUR',
          category: t('vac.category'), notes: countryName(v.country), trip_id: trip.id,
        }
        if (next.expense_id) await db().from('expenses').update(row as never).eq('id', next.expense_id)
        else {
          const { data } = await db().from('expenses').insert({ ...row, user_id: user.id, spent_at: new Date().toISOString() } as never).select('id').single()
          next = { ...next, expense_id: (data as unknown as { id: string } | null)?.id }
        }
      } else if (next.expense_id && !next.cost) {
        await db().from('expenses').delete().eq('id', next.expense_id)
        next = { ...next, expense_id: undefined }
      }
      const entries = { ...(v.entries ?? {}), [uid]: next }
      const { error: err } = await db().from('trip_vaccines').update({ entries } as never).eq('id', v.id)
      if (err) throw err
      setRows((list) => list.map((x) => (x.id === v.id ? { ...x, entries } : x)))
      await syncTodo(v, entries)
      await hub.reload()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function remove(v: TripVaccine) {
    if (confirmId !== v.id) {
      setConfirmId(v.id)
      return
    }
    setConfirmId(null)
    for (const e of Object.values(v.entries ?? {})) if (e.expense_id) await db().from('expenses').delete().eq('id', e.expense_id)
    if (v.todo_id) await db().from('trip_todos').delete().eq('id', v.todo_id)
    await db().from('trip_vaccines').delete().eq('id', v.id)
    setRows((list) => list.filter((x) => x.id !== v.id))
    await hub.reload()
  }

  async function addManual(country: string) {
    const name = newName.trim()
    if (!name) return
    const { error: err } = await db().from('trip_vaccines').insert({ trip_id: trip.id, country, name: name.slice(0, 80), level: 'recommended' } as never)
    if (err) setError(errorMessage(err))
    setNewName('')
    setAdding(null)
    await load()
  }

  if (loading) return <p className="py-10 text-center text-text-muted">{t('common.loading')}</p>

  return (
    <div className="space-y-6">
      {error && <p className="notice notice-bad">{error}</p>}

      <section className="card-feature p-5">
        <p className="eyebrow eyebrow-dot">{t('vac.title')}</p>
        <p className="mt-2 text-[13.5px] leading-relaxed text-text-soft">{t('vac.intro')}</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-surface p-3">
            <p className="eyebrow">{t('vac.spent')}</p>
            <p className="num mt-1 text-[1.2rem] font-extrabold">
              {totals.spent.length ? totals.spent.map(([c, v]) => money(v, c)).join(' · ') : money(0)}
            </p>
          </div>
          <div className="rounded-2xl bg-surface p-3">
            <p className="eyebrow">{t('vac.estimated')}</p>
            <p className="num mt-1 text-[1.2rem] font-extrabold">{totals.estimated ? `~${money(totals.estimated)}` : '·'}</p>
          </div>
        </div>
        <p className="mt-3 text-[11.5px] leading-snug text-text-muted">⚕️ {t('vac.disclaimer')}</p>
      </section>

      {countries.length === 0 && <p className="rounded-[22px] border border-dashed border-line-strong p-5 text-[14px] text-text-muted">{t('vac.noCountry')}</p>}

      {countries.map((country) => {
        const list = rows.filter((r) => r.country === country)
        const running = jobs.find((j) => j.kind === 'vaccines' && j.trip_id === trip.id && String(j.input?.country) === country && (j.status === 'pending' || j.status === 'processing'))
        return (
          <section key={country}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-[1.25rem] font-extrabold">
                {flagOf(country)} {countryName(country)} <span className="num text-[1rem] text-text-muted">{list.length}</span>
              </h2>
              <button
                disabled={Boolean(running)}
                onClick={() => void queue('vaccines', { country, lang }, trip.id)}
                className="btn btn-xs"
              >
                🔄 {list.length ? t('vac.refresh') : t('vac.search')}
              </button>
            </div>

            {running && (
              <div className="mb-3 rounded-2xl border border-line bg-surface p-3.5">
                <AiGauge job={running} />
                <p className="mt-2 text-[12px] text-text-muted">{t('vac.running')}</p>
              </div>
            )}

            <ul className="space-y-3">
              {list.map((v) => (
                <li key={v.id} className="rounded-[22px] border border-line bg-surface p-4 shadow-[var(--shadow-sm)]">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[16px] font-extrabold">💉 {v.name}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <span className={`chip ${v.level === 'required' ? 'chip-bad' : v.level === 'recommended' ? 'chip-warn' : ''}`}>{t(`vac.level.${v.level}` as 'vac.level.required')}</span>
                        {v.est_price ? <span className="chip num">~{money(v.est_price, v.currency)} / {t('vac.perPerson')}</span> : null}
                        {v.timing && <span className="chip">⏱ {v.timing}</span>}
                      </div>
                    </div>
                    <button onClick={() => void remove(v)} className={`btn btn-xs shrink-0 ${confirmId === v.id ? 'btn-accent' : 'btn-quiet'}`} aria-label={t('common.delete')}>
                      {confirmId === v.id ? t('common.confirm') : '×'}
                    </button>
                  </div>
                  {v.why && <p className="mt-2 text-[13.5px] leading-snug text-text-soft">{v.why}</p>}
                  {(v.doses || v.advice) && <p className="mt-1 text-[12.5px] leading-snug text-text-muted">{[v.doses, v.advice].filter(Boolean).join(' · ')}</p>}
                  {v.sources?.length > 0 && (
                    <p className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-text-muted">
                      {v.sources.slice(0, 3).map((s) => (
                        <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="hover:underline">
                          {s.title || s.url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}
                        </a>
                      ))}
                    </p>
                  )}

                  {/* Chacun decide pour lui */}
                  <div className="mt-3.5 space-y-3 border-t border-line pt-3">
                    {people.map((p) => {
                      const e = entryOf(v, p.user_id)
                      const key = `${v.id}:${p.user_id}`
                      return (
                        <div key={p.user_id}>
                          <p className="mb-1.5 text-[12.5px] font-bold">{p.display_name}</p>
                          <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label={p.display_name}>
                            {STATUSES.map((st) => (
                              <button
                                key={st}
                                role="radio"
                                aria-checked={e.status === st}
                                onClick={() => void setEntry(v, p.user_id, { status: st })}
                                className={`rounded-xl border px-1 py-2 text-[11.5px] font-bold leading-tight transition-all active:scale-95 ${
                                  e.status === st
                                    ? st === 'taken' ? 'border-[var(--color-olive)] bg-[rgba(124,135,103,0.18)]' : st === 'skip' ? 'border-line-strong bg-surface-2' : 'border-accent bg-[var(--halo)]'
                                    : 'border-line text-text-muted'
                                }`}
                              >
                                {t(`vac.st.${st}` as 'vac.st.todo')}
                              </button>
                            ))}
                          </div>
                          {e.status === 'taken' && (
                            <div className="fade-in mt-2 flex gap-2">
                              <input
                                className="field num flex-1"
                                inputMode="decimal"
                                placeholder={t('vac.pricePh')}
                                value={costDraft[key] ?? (e.cost ? String(e.cost) : '')}
                                onChange={(ev) => setCostDraft((d) => ({ ...d, [key]: ev.target.value }))}
                                onBlur={() => {
                                  const raw = costDraft[key]
                                  if (raw === undefined) return
                                  const n = Number(raw.replace(',', '.'))
                                  void setEntry(v, p.user_id, { cost: Number.isFinite(n) && n > 0 ? n : undefined, currency: e.currency ?? 'EUR' })
                                }}
                              />
                              <input
                                className="field w-20 uppercase"
                                maxLength={3}
                                value={e.currency ?? 'EUR'}
                                onChange={(ev) => void setEntry(v, p.user_id, { currency: ev.target.value.toUpperCase() })}
                              />
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </li>
              ))}
            </ul>

            {adding === country ? (
              <div className="fade-in mt-3 flex gap-2">
                <input className="field flex-1" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t('vac.newPh')} autoFocus />
                <button onClick={() => void addManual(country)} className="btn btn-accent">
                  {t('common.save')}
                </button>
              </div>
            ) : (
              <button onClick={() => setAdding(country)} className="btn btn-quiet btn-xs mt-3">
                ＋ {t('vac.add')}
              </button>
            )}
          </section>
        )
      })}
    </div>
  )
}
