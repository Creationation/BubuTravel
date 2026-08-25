import { useState } from 'react'
import { usePlaces } from '../context/PlacesContext'
import { useAuth } from '../context/AuthContext'
import { errorMessage } from '../lib/errors'
import { groupByDay, replaceActivity, requestPlan } from '../lib/planner'
import type { Plan, PlanRequest, PlannedActivity } from '../lib/planner'
import { formatMoney } from '../components/PlaceExtras'
import AppShell from '../components/AppShell'
import Reveal from '../components/Reveal'

const INTERESTS = [
  'Nature',
  'Randonnee',
  'Musees',
  'Histoire',
  'Gastronomie',
  'Marches',
  'Plage',
  'Vie nocturne',
  'Architecture',
  'Shopping',
  'Avec des enfants',
  'Hors des sentiers battus',
]

const BUDGETS: { value: PlanRequest['budget']; label: string }[] = [
  { value: 'petit', label: 'Petit budget' },
  { value: 'moyen', label: 'Moyen' },
  { value: 'confortable', label: 'Confortable' },
  { value: 'luxe', label: 'Luxe' },
]

const PACES: { value: PlanRequest['pace']; label: string; hint: string }[] = [
  { value: 'tranquille', label: 'Tranquille', hint: 'Deux activites par jour' },
  { value: 'equilibre', label: 'Equilibre', hint: 'Trois activites par jour' },
  { value: 'dense', label: 'Dense', hint: 'Cinq activites par jour' },
]

export default function PlannerPage() {
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
      setError('Indiquez une ville ou un pays.')
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
        title: `${form.destination.trim()}, ${form.days} jour${form.days > 1 ? 's' : ''}`,
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
            <p className="eyebrow">Planificateur</p>
            <h1 className="display mt-4 text-[clamp(2.2rem,6vw,4rem)]">
              Dites ou, on s'occupe du reste
            </h1>
            <p className="lede mt-5 max-w-xl">
              Quelques questions, et vous repartez avec un itineraire jour par jour : des endroits
              qui existent, leur adresse, une duree et un budget indicatif. Vous gardez ce qui vous
              plait, vous remplacez le reste.
            </p>
          </Reveal>
        </section>

        {/* Les questions */}
        <Reveal className="mt-10">
          <div className="panel space-y-5 p-6 sm:p-8">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="label">Ou allez-vous ?</label>
                <input
                  className="field"
                  value={form.destination}
                  onChange={(e) => set('destination', e.target.value)}
                  placeholder="Lisbonne, ou le Portugal, ou la Toscane"
                  onKeyDown={(e) => e.key === 'Enter' && void generate()}
                />
              </div>
              <div>
                <label className="label">Combien de jours ?</label>
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
                <label className="label">Combien de personnes ?</label>
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
                <label className="label">A quelle periode ?</label>
                <input
                  className="field"
                  value={form.season}
                  onChange={(e) => set('season', e.target.value)}
                  placeholder="En avril, l'ete prochain, a Noel..."
                />
              </div>
            </div>

            <div>
              <label className="label">Ce qui vous interesse</label>
              <div className="flex flex-wrap gap-2">
                {INTERESTS.map((item) => {
                  const on = form.interests.includes(item)
                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() =>
                        set(
                          'interests',
                          on
                            ? form.interests.filter((i) => i !== item)
                            : [...form.interests, item],
                        )
                      }
                      className={`pill ${on ? 'pill-active' : ''}`}
                    >
                      {item}
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
                      {b.label}
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
                      title={p.hint}
                      onClick={() => set('pace', p.value)}
                      className={`pill ${form.pace === p.value ? 'pill-active' : ''}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="label">Autre chose ?</label>
              <textarea
                className="field min-h-20 resize-y"
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                placeholder="On voyage avec un bebe, on n'aime pas la foule, on est vegetariens..."
              />
            </div>

            {error && <p className="notice notice-bad">{error}</p>}

            <div className="flex flex-wrap gap-2">
              <button onClick={() => void generate()} className="btn btn-accent" disabled={busy}>
                {busy ? 'Preparation en cours...' : plan ? 'Tout remplacer' : "Proposer un itineraire"}
              </button>
              {plan && (
                <button
                  onClick={() => void keepAll()}
                  className="btn"
                  disabled={savingAll || busy}
                >
                  {savingAll ? 'Ajout au carnet...' : 'Tout garder dans un voyage'}
                </button>
              )}
            </div>

            {busy && (
              <p className="text-[13px] text-text-muted">
                Cela prend une trentaine de secondes : l'itineraire est reflechi, pas pioche au
                hasard.
              </p>
            )}
          </div>
        </Reveal>

        {/* La proposition */}
        {plan && (
          <>
            <Reveal className="mt-12">
              <div className="panel p-6 sm:p-8">
                <p className="eyebrow">La proposition</p>
                <p className="lede mt-3">{plan.summary}</p>
                <p className="mt-4 text-[13px] text-text-muted">
                  Budget indicatif : {formatMoney(plan.total_estimate, plan.currency)} par personne,
                  hors transport et hebergement. A verifier avant de reserver.
                </p>
              </div>
            </Reveal>

            <div className="mt-10 space-y-12">
              {days.map(({ day, items }) => (
                <section key={day}>
                  <Reveal className="mb-5 flex items-center gap-4">
                    <h2 className="display text-4xl text-text-muted">Jour {day}</h2>
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
                                  <span className="eyebrow mb-0">{activity.moment}</span>
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
                                    {activity.duration_hours} h
                                  </span>
                                  <span className="pill">
                                    {activity.price_estimate > 0
                                      ? formatMoney(activity.price_estimate, activity.currency)
                                      : 'Gratuit'}
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
                                  {saved.has(index) ? 'Dans les envies' : 'Garder'}
                                </button>
                                <button
                                  onClick={() => void replaceOne(index)}
                                  className="btn btn-xs btn-quiet"
                                  disabled={replacing !== null || busy}
                                >
                                  {replacing === index ? 'Recherche...' : 'Remplacer'}
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
              <p className="mt-10 text-[13px] text-text-muted">
                Les endroits gardes arrivent dans vos envies. Rattachez-les ensuite a un voyage
                depuis leur panneau sur la carte.
              </p>
            )}
          </>
        )}
      </div>
    </AppShell>
  )
}
