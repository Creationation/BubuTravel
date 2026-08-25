import { useState } from 'react'
import { usePlaces } from '../context/PlacesContext'
import { useAuth } from '../context/AuthContext'
import { errorMessage } from '../lib/errors'
import { groupByDay, replaceActivity, requestPlan } from '../lib/planner'
import type { Plan, PlanRequest, PlannedActivity } from '../lib/planner'
import { formatMoney } from '../components/PlaceExtras'
import { plural } from '../lib/stats'
import AppShell from '../components/AppShell'
import Reveal from '../components/Reveal'
import { useT } from '../i18n/I18nContext'
import type { Key } from '../i18n/fr'

/**
 * Les listes portent des cles, pas des libelles : le texte envoye au modele
 * reste stable quelle que soit la langue affichee, et seule la traduction
 * change a l'ecran.
 */
const INTERESTS: { value: string; label: Key }[] = [
  { value: 'Nature', label: 'interest.nature' },
  { value: 'Randonnee', label: 'interest.hiking' },
  { value: 'Musees', label: 'interest.museums' },
  { value: 'Histoire', label: 'interest.history' },
  { value: 'Gastronomie', label: 'interest.food' },
  { value: 'Marches', label: 'interest.markets' },
  { value: 'Plage', label: 'interest.beach' },
  { value: 'Vie nocturne', label: 'interest.nightlife' },
  { value: 'Architecture', label: 'interest.architecture' },
  { value: 'Shopping', label: 'interest.shopping' },
  { value: 'Avec des enfants', label: 'interest.kids' },
  { value: 'Hors des sentiers battus', label: 'interest.offbeat' },
]

const BUDGETS: { value: PlanRequest['budget']; label: Key }[] = [
  { value: 'petit', label: 'planner.budgetSmall' },
  { value: 'moyen', label: 'planner.budgetMid' },
  { value: 'confortable', label: 'planner.budgetComfort' },
  { value: 'luxe', label: 'planner.budgetLux' },
]

const PACES: { value: PlanRequest['pace']; label: Key; hint: Key }[] = [
  { value: 'tranquille', label: 'planner.paceSlow', hint: 'planner.paceSlowHint' },
  { value: 'equilibre', label: 'planner.paceEven', hint: 'planner.paceEvenHint' },
  { value: 'dense', label: 'planner.paceDense', hint: 'planner.paceDenseHint' },
]

const MOMENT_KEYS: Record<PlannedActivity['moment'], Key> = {
  matin: 'moment.matin',
  midi: 'moment.midi',
  'apres-midi': 'moment.apresmidi',
  soir: 'moment.soir',
}

export default function PlannerPage() {
  const t = useT()
  const { profile } = useAuth()
  const { trips, addTrip, add } = usePlaces()

  const [form, setForm] = useState<PlanRequest>({
    destination: '',
    days: 3,
    travellers: 2,
    interests: [],
    budget: 'moyen',
    pace: 'equilibre',
    season: '',
    notes: '',
    lang: profile?.lang ?? 'fr',
  })
  const [plan, setPlan] = useState<Plan | null>(null)
  const [busy, setBusy] = useState(false)
  const [replacing, setReplacing] = useState<number | null>(null)
  const [saved, setSaved] = useState<Set<number>>(new Set())
  const [savingAll, setSavingAll] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set<K extends keyof PlanRequest>(key: K, value: PlanRequest[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function generate() {
    if (form.destination.trim().length < 2) {
      setError(t('planner.needDestination'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await requestPlan({ ...form, destination: form.destination.trim() })
      setPlan(result)
      setSaved(new Set())
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function replaceOne(index: number) {
    if (!plan) return
    setReplacing(index)
    setError(null)
    try {
      const result = await replaceActivity(form, plan.activities, index)
      setPlan(result)
      // Les rangs ont pu bouger : on repart d'une ardoise propre
      setSaved(new Set())
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setReplacing(null)
    }
  }

  /** Une proposition devient une envie du carnet, pas un lieu deja visite. */
  async function keep(activity: PlannedActivity, index: number, tripId: string | null) {
    setError(null)
    try {
      await add({
        name: activity.name,
        country: activity.country,
        city: activity.city || null,
        lat: activity.lat,
        lng: activity.lng,
        visit_date: null,
        notes: [activity.why, activity.address, activity.booking].filter(Boolean).join('\n\n'),
        trip_id: tripId,
        category_id: null,
        status: 'wishlist',
        planned_order: index,
        cost: null,
        currency: activity.currency || 'EUR',
        price_level: null,
        rating: null,
        review: null,
        promo_note: null,
        promo_code: null,
        promo_until: null,
      })
      setSaved((prev) => new Set(prev).add(index))
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  /** Cree un voyage a preparer et y verse toutes les propositions. */
  async function keepAll() {
    if (!plan) return
    setSavingAll(true)
    setError(null)
    try {
      const trip = await addTrip({
        title: `${form.destination.trim()}, ${plural(form.days, t('unit.day'), t('unit.days'))}`,
        start_date: null,
        end_date: null,
        cover_url: null,
        notes: plan.summary,
        status: 'planning',
        checklist: [],
      })
      for (let i = 0; i < plan.activities.length; i++) {
        if (saved.has(i)) continue
        await keep(plan.activities[i], i, trip.id)
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSavingAll(false)
    }
  }

  const days = plan ? groupByDay(plan.activities) : []

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-6xl px-5 pb-24 sm:px-8">
        <section className="border-b border-line py-12 sm:py-16">
          <Reveal>
            <p className="eyebrow">{t('planner.eyebrow')}</p>
            <h1 className="display mt-4 text-[clamp(2.2rem,6vw,4rem)]">{t('planner.title')}</h1>
            <p className="lede mt-5 max-w-xl">{t('planner.intro')}</p>
          </Reveal>
        </section>

        {/* Les questions */}
        <Reveal className="mt-10">
          <div className="panel space-y-5 p-6 sm:p-8">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="label">{t('planner.where')}</label>
                <input
                  className="field"
                  value={form.destination}
                  onChange={(e) => set('destination', e.target.value)}
                  placeholder={t('planner.wherePlaceholder')}
                  onKeyDown={(e) => e.key === 'Enter' && void generate()}
                />
              </div>
              <div>
                <label className="label">{t('planner.howLong')}</label>
                <input
                  className="field"
                  type="number"
                  min={1}
                  max={30}
                  value={form.days}
                  onChange={(e) => set('days', Math.max(1, Math.min(30, Number(e.target.value))))}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="label">{t('planner.howMany')}</label>
                <input
                  className="field"
                  type="number"
                  min={1}
                  max={20}
                  value={form.travellers}
                  onChange={(e) =>
                    set('travellers', Math.max(1, Math.min(20, Number(e.target.value))))
                  }
                />
              </div>
              <div className="sm:col-span-2">
                <label className="label">{t('planner.when')}</label>
                <input
                  className="field"
                  value={form.season}
                  onChange={(e) => set('season', e.target.value)}
                  placeholder={t('planner.whenPlaceholder')}
                />
              </div>
            </div>

            <div>
              <label className="label">{t('planner.interests')}</label>
              <div className="flex flex-wrap gap-2">
                {INTERESTS.map((item) => {
                  const on = form.interests.includes(item.value)
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() =>
                        set(
                          'interests',
                          on
                            ? form.interests.filter((i) => i !== item.value)
                            : [...form.interests, item.value],
                        )
                      }
                      className={`pill ${on ? 'pill-active' : ''}`}
                    >
                      {t(item.label)}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Budget</label>
                <div className="flex flex-wrap gap-2">
                  {BUDGETS.map((b) => (
                    <button
                      key={b.value}
                      type="button"
                      onClick={() => set('budget', b.value)}
                      className={`pill ${form.budget === b.value ? 'pill-active' : ''}`}
                    >
                      {t(b.label)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="label">Rythme</label>
                <div className="flex flex-wrap gap-2">
                  {PACES.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      title={t(p.hint)}
                      onClick={() => set('pace', p.value)}
                      className={`pill ${form.pace === p.value ? 'pill-active' : ''}`}
                    >
                      {t(p.label)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="label">{t('planner.anythingElse')}</label>
              <textarea
                className="field min-h-20 resize-y"
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                placeholder={t('planner.anythingPlaceholder')}
              />
            </div>

            {error && <p className="notice notice-bad">{error}</p>}

            <div className="flex flex-wrap gap-2">
              <button onClick={() => void generate()} className="btn btn-accent" disabled={busy}>
                {busy ? t('planner.working') : plan ? t('planner.regenerate') : t('planner.generate')}
              </button>
              {plan && (
                <button
                  onClick={() => void keepAll()}
                  className="btn"
                  disabled={savingAll || busy}
                >
                  {savingAll ? t('planner.savingAll') : t('planner.keepAll')}
                </button>
              )}
            </div>

            {busy && (
              <p className="text-[13px] text-text-muted">{t('planner.patience')}</p>
            )}
          </div>
        </Reveal>

        {/* La proposition */}
        {plan && (
          <>
            <Reveal className="mt-12">
              <div className="panel p-6 sm:p-8">
                <p className="eyebrow">{t('planner.proposal')}</p>
                <p className="lede mt-3">{plan.summary}</p>
                <p className="mt-4 text-[13px] text-text-muted">
                  {t('planner.budgetNote', {
                    amount: formatMoney(plan.total_estimate, plan.currency),
                  })}
                </p>
              </div>
            </Reveal>

            <div className="mt-10 space-y-12">
              {days.map(({ day, items }) => (
                <section key={day}>
                  <Reveal className="mb-5 flex items-center gap-4">
                    <h2 className="display text-4xl text-text-muted">
                      {t('planner.day', { n: day })}
                    </h2>
                    <span className="ornament flex-1">
                      <span className="ornament-dot" />
                    </span>
                  </Reveal>

                  <ul className="space-y-4">
                    {items.map((activity) => {
                      const index = plan.activities.indexOf(activity)
                      return (
                        <Reveal as="li" key={`${day}-${activity.name}`}>
                          <article className="panel p-5 sm:p-6">
                            <div className="flex flex-wrap items-start justify-between gap-4">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="eyebrow mb-0">
                                    {t(MOMENT_KEYS[activity.moment])}
                                  </span>
                                  <span className="pill">{activity.kind}</span>
                                </div>
                                <h3 className="display-sm mt-2 text-2xl">{activity.name}</h3>
                                <p className="mt-1 text-[13px] text-text-muted">
                                  {activity.address}
                                  {activity.city && `, ${activity.city}`}
                                </p>
                                <p className="mt-3 text-[14px] leading-relaxed text-text-soft">
                                  {activity.why}
                                </p>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <span className="pill">
                                    {t('planner.hours', { n: activity.duration_hours })}
                                  </span>
                                  <span className="pill">
                                    {activity.price_estimate > 0
                                      ? formatMoney(activity.price_estimate, activity.currency)
                                      : t('planner.free')}
                                  </span>
                                </div>
                                {activity.booking && (
                                  <p className="notice mt-3">{activity.booking}</p>
                                )}
                              </div>

                              <div className="flex shrink-0 flex-col gap-2">
                                <button
                                  onClick={() => void keep(activity, index, null)}
                                  className={`btn btn-xs ${saved.has(index) ? '' : 'btn-accent'}`}
                                  disabled={saved.has(index)}
                                >
                                  {saved.has(index) ? t('planner.kept') : t('planner.keep')}
                                </button>
                                <button
                                  onClick={() => void replaceOne(index)}
                                  className="btn btn-xs btn-quiet"
                                  disabled={replacing !== null || busy}
                                >
                                  {replacing === index ? t('planner.searchingAlt') : t('planner.replace')}
                                </button>
                              </div>
                            </div>
                          </article>
                        </Reveal>
                      )
                    })}
                  </ul>
                </section>
              ))}
            </div>

            {trips.length > 0 && (
              <p className="mt-10 text-[13px] text-text-muted">{t('planner.attachHint')}</p>
            )}
          </>
        )}
      </div>
    </AppShell>
  )
}
