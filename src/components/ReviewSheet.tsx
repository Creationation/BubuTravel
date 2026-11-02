import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { usePlaces } from '../context/PlacesContext'
import { useAuth } from '../context/AuthContext'
import type { Place } from '../lib/types'
import { useI18n } from '../i18n/I18nContext'
import type { Key } from '../i18n/fr'
import Portal from './Portal'

export type Feedback = {
  overall?: number
  price?: number
  service?: number
  again?: 'yes' | 'maybe' | 'no'
  paid?: number
  currency?: string
  /** Petit mot par question : { overall: '...', price: '...' } */
  notes?: Partial<Record<Choice, string>>
  comment?: string
  name?: string
  at?: string
}

type Choice = 'overall' | 'price' | 'service' | 'again'
type Step = Choice | 'paid' | 'comment'
const STEPS: Step[] = ['overall', 'price', 'paid', 'service', 'again', 'comment']

const OPTIONS: Record<Choice, { value: number | string; emoji: string; label: Key }[]> = {
  overall: [
    { value: 1, emoji: '😕', label: 'rv.o.overall.1' },
    { value: 2, emoji: '😐', label: 'rv.o.overall.2' },
    { value: 3, emoji: '🙂', label: 'rv.o.overall.3' },
    { value: 4, emoji: '😍', label: 'rv.o.overall.4' },
    { value: 5, emoji: '🤩', label: 'rv.o.overall.5' },
  ],
  price: [
    { value: 1, emoji: '💸', label: 'rv.o.price.1' },
    { value: 2, emoji: '👌', label: 'rv.o.price.2' },
    { value: 3, emoji: '🤏', label: 'rv.o.price.3' },
    { value: 4, emoji: '😬', label: 'rv.o.price.4' },
  ],
  service: [
    { value: 1, emoji: '👎', label: 'rv.o.service.1' },
    { value: 2, emoji: '🙂', label: 'rv.o.service.2' },
    { value: 3, emoji: '😊', label: 'rv.o.service.3' },
    { value: 4, emoji: '🌟', label: 'rv.o.service.4' },
  ],
  again: [
    { value: 'yes', emoji: '💯', label: 'rv.o.again.yes' },
    { value: 'maybe', emoji: '🤔', label: 'rv.o.again.maybe' },
    { value: 'no', emoji: '🙅', label: 'rv.o.again.no' },
  ],
}
const COLS: Record<number, string> = { 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5' }
const CURRENCIES = ['THB', 'VND', 'EUR', 'USD']

/** Devise par defaut d'apres le pays du lieu. */
function defaultCurrency(place: Place): string {
  const c = (place.country ?? '').toLowerCase()
  if (c.includes('tha')) return 'THB'
  if (c.includes('viet')) return 'VND'
  return 'EUR'
}

export function feedbackOf(place: Place): Record<string, Feedback> {
  return ((place as Place & { feedback?: Record<string, Feedback> }).feedback ?? {}) as Record<string, Feedback>
}

/** Libelle en mots d'une reponse (pour le resume, sans emoji). */
function labelFor(step: Choice, value: unknown, t: (k: Key) => string): string {
  const o = OPTIONS[step].find((x) => x.value === value)
  return o ? t(o.label) : ''
}

/**
 * Avis apres une visite : une question a la fois. On touche un choix (avec
 * son emoji), on peut ajouter un detail dans la petite case, puis Suivant.
 * Une etape pour le prix paye. Chaque voyageur a son propre avis.
 */
export default function ReviewSheet({ place, onClose }: { place: Place; onClose: () => void }) {
  const { t } = useI18n()
  const { user } = useAuth()
  const { reload } = usePlaces()
  const mine = (user && feedbackOf(place)[user.id]) || {}
  const [answers, setAnswers] = useState<Feedback>({ currency: defaultCurrency(place), ...mine })
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const current = STEPS[step]
  const last = step === STEPS.length - 1

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  function setNote(step: Choice, text: string) {
    setAnswers((a) => ({ ...a, notes: { ...(a.notes ?? {}), [step]: text.slice(0, 160) } }))
  }

  async function save() {
    setBusy(true)
    try {
      const notes = Object.fromEntries(Object.entries(answers.notes ?? {}).filter(([, v]) => v && v.trim()))
      const payload = { ...answers, notes, comment: answers.comment?.trim() || undefined }
      await supabase.rpc('set_place_feedback' as never, { p_place: place.id, p_feedback: payload } as never)
      await reload()
      setDone(true)
      window.setTimeout(onClose, 900)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Portal><div className="fixed inset-0 z-[1300] flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        className="panel-enter max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-[30px] bg-bg p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-[var(--shadow-lg)] sm:rounded-[30px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line-strong sm:hidden" />
        <p className="text-center text-[13px] font-semibold text-text-muted">{place.name}</p>
        <h2 className="mt-1 text-center text-[1.5rem] font-extrabold">{done ? t('rv.saved') : t('rv.title')}</h2>

        {!done && (
          <div className="mt-4 flex justify-center gap-1.5">
            {STEPS.map((s, i) => (
              <span key={s} className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? 'w-6 bg-accent' : i < step ? 'w-1.5 bg-accent/60' : 'w-1.5 bg-line-strong'}`} />
            ))}
          </div>
        )}

        {done ? (
          <p className="py-8 text-center text-6xl">🎉</p>
        ) : (
          <div key={current} className="fade-in mt-6 min-h-[15rem]">
            <p className="text-center text-[1.15rem] font-bold">{t(`rv.q.${current}` as Key)}</p>

            {current === 'comment' && (
              <textarea
                autoFocus
                className="field mt-4 min-h-28 resize-none text-[15px]"
                value={answers.comment ?? ''}
                onChange={(e) => setAnswers({ ...answers, comment: e.target.value.slice(0, 280) })}
                placeholder={t('rv.commentPh')}
              />
            )}

            {current === 'paid' && (
              <div className="mt-5">
                <div className="flex gap-2">
                  <input
                    inputMode="decimal"
                    className="field num text-center text-[1.6rem] font-extrabold"
                    value={answers.paid ?? ''}
                    onChange={(e) => {
                      const n = parseFloat(e.target.value.replace(',', '.'))
                      setAnswers({ ...answers, paid: Number.isFinite(n) ? n : undefined })
                    }}
                    placeholder="0"
                  />
                  <select
                    className="field w-28 text-[15px] font-bold"
                    value={answers.currency}
                    onChange={(e) => setAnswers({ ...answers, currency: e.target.value })}
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <p className="mt-2 text-center text-[12px] text-text-muted">{t('rv.paidHint')}</p>
              </div>
            )}

            {current !== 'comment' && current !== 'paid' && (
              <>
                <div className={`mt-5 grid gap-2 ${COLS[OPTIONS[current].length] ?? 'grid-cols-3'}`}>
                  {OPTIONS[current].map((o) => {
                    const active = answers[current] === o.value
                    return (
                      <button
                        key={String(o.value)}
                        onClick={() => setAnswers({ ...answers, [current]: o.value })}
                        className={`flex flex-col items-center gap-1.5 rounded-2xl border px-1 py-3 transition-all duration-200 ${
                          active ? 'scale-105 border-accent bg-[var(--halo)] shadow-[var(--shadow-sm)]' : 'border-line bg-surface'
                        }`}
                      >
                        <span className="text-[2rem] leading-none">{o.emoji}</span>
                        <span className="text-center text-[11px] font-semibold leading-tight">{t(o.label)}</span>
                      </button>
                    )
                  })}
                </div>
                <input
                  className="field mt-3 text-[14px]"
                  value={answers.notes?.[current] ?? ''}
                  onChange={(e) => setNote(current, e.target.value)}
                  placeholder={t('rv.detail')}
                />
              </>
            )}
          </div>
        )}

        {!done && (
          <div className="mt-5 flex items-center gap-2">
            {step > 0 ? (
              <button onClick={() => setStep((s) => s - 1)} className="btn btn-quiet">
                {t('rv.back')}
              </button>
            ) : (
              <button onClick={onClose} className="btn btn-quiet">
                {t('rv.skip')}
              </button>
            )}
            {last ? (
              <button onClick={() => void save()} disabled={busy} className="btn btn-accent ml-auto">
                {t('rv.done')}
              </button>
            ) : (
              <button onClick={() => setStep((s) => s + 1)} className="btn btn-accent ml-auto">
                {t('rv.next')}
              </button>
            )}
          </div>
        )}
      </div>
    </div></Portal>
  )
}

/** Les avis du voyage sur ce lieu, en mots, un par voyageur. */
export function ReviewSummary({ place, onEdit }: { place: Place; onEdit: () => void }) {
  const { t } = useI18n()
  const { user } = useAuth()
  const all = Object.entries(feedbackOf(place))
  const hasMine = Boolean(user && feedbackOf(place)[user.id])
  return (
    <div className="space-y-3">
      {all.length > 0 && (
        <div>
          <p className="eyebrow mb-2">{t('rv.ours')}</p>
          <ul className="space-y-2">
            {all.map(([uid, f]) => {
              const rows = (
                [
                  ['overall', t('rv.lbl.overall'), labelFor('overall', f.overall, t)],
                  ['price', t('rv.lbl.price'), labelFor('price', f.price, t)],
                  ['paid', t('rv.lbl.paid'), f.paid != null ? `${f.paid.toLocaleString()} ${f.currency ?? ''}` : ''],
                  ['service', t('rv.lbl.service'), labelFor('service', f.service, t)],
                  ['again', t('rv.lbl.again'), labelFor('again', f.again, t)],
                ] as [string, string, string][]
              ).filter(([, , v]) => v)
              return (
                <li key={uid} className="rounded-2xl border border-line bg-surface p-3.5">
                  <p className="text-[14px] font-extrabold">{uid === user?.id ? t('rv.you') : f.name}</p>
                  <dl className="mt-2 space-y-1.5">
                    {rows.map(([k, label, value]) => (
                      <div key={k} className="text-[14px]">
                        <div className="flex justify-between gap-3">
                          <dt className="text-text-muted">{label}</dt>
                          <dd className="text-right font-semibold">{value}</dd>
                        </div>
                        {f.notes?.[k as Choice] && <p className="text-[13px] text-text-soft">{f.notes[k as Choice]}</p>}
                      </div>
                    ))}
                  </dl>
                  {f.comment && <p className="mt-2 border-t border-line pt-2 text-[14px] leading-snug text-text-soft">{f.comment}</p>}
                </li>
              )
            })}
          </ul>
        </div>
      )}
      <button onClick={onEdit} className="btn w-full">
        {hasMine ? t('rv.edit') : t('rv.open')}
      </button>
    </div>
  )
}

/** Demande d'avis : n'importe quel ecran peut l'ouvrir apres une visite. */
export function askReview(placeId: string) {
  window.dispatchEvent(new CustomEvent('bubu:review', { detail: placeId }))
}

/** Monte une fois (dans la coquille de l'app) : affiche la fenetre d'avis. */
export function ReviewHost() {
  const { places } = usePlaces()
  const [id, setId] = useState<string | null>(null)
  useEffect(() => {
    const on = (e: Event) => setId((e as CustomEvent<string>).detail)
    window.addEventListener('bubu:review', on)
    return () => window.removeEventListener('bubu:review', on)
  }, [])
  const place = id ? places.find((p) => p.id === id) : null
  if (!place) return null
  return <ReviewSheet place={place} onClose={() => setId(null)} />
}
