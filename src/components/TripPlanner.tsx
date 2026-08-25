import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePlaces } from '../context/PlacesContext'
import { errorMessage } from '../lib/errors'
import { formatDate, plural, totalDistanceKm } from '../lib/stats'
import type { ChecklistItem, Place, Trip } from '../lib/types'
import { useT } from '../i18n/I18nContext'

/**
 * Preparation d'un voyage : etapes ordonnees a la main, dates visees et
 * pense-bete. Les etapes sont des lieux ordinaires, en general des envies de
 * la bucketlist, qui basculeront dans le carnet une fois le voyage fait.
 */
export default function TripPlanner({ trip }: { trip: Trip }) {
  const t = useT()
  const { places, edit, editTrip, categoryOf } = usePlaces()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newItem, setNewItem] = useState('')
  const [confirmDone, setConfirmDone] = useState(false)

  const steps = useMemo(() => {
    const mine = places.filter((p) => p.trip_id === trip.id)
    return [...mine].sort((a, b) => {
      // L'ordre choisi a la main prime, la date sert de repli
      const ao = a.planned_order
      const bo = b.planned_order
      if (ao !== null && bo !== null) return ao - bo
      if (ao !== null) return -1
      if (bo !== null) return 1
      return (a.visit_date ?? '').localeCompare(b.visit_date ?? '')
    })
  }, [places, trip.id])

  const checklist: ChecklistItem[] = Array.isArray(trip.checklist) ? trip.checklist : []
  const doneCount = checklist.filter((i) => i.done).length
  const km = totalDistanceKm(steps.filter((s) => s.visit_date))

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Deplace une etape et renumerote toute la liste. Renumeroter d'un bloc
   * evite les trous et les egalites qui rendraient l'ordre instable.
   */
  function move(index: number, delta: number) {
    const next = [...steps]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    void run(async () => {
      for (let i = 0; i < next.length; i++) {
        if (next[i].planned_order !== i) await edit(next[i].id, { planned_order: i })
      }
    })
  }

  function setChecklist(items: ChecklistItem[]) {
    void run(() => editTrip(trip.id, { checklist: items }))
  }

  /** Le voyage passe en fait : ses envies deviennent des lieux visites. */
  function finishTrip() {
    void run(async () => {
      for (const step of steps) {
        if (step.status === 'wishlist') {
          await edit(step.id, { status: 'visited', visit_date: step.visit_date })
        }
      }
      await editTrip(trip.id, { status: 'done' })
    })
  }

  return (
    <div className="space-y-10">
      {error && <p className="notice notice-bad">{error}</p>}

      {/* Itineraire */}
      <section>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">{t('planner.itinerary')}</p>
            <h2 className="display-sm mt-2 text-3xl">{plural(steps.length, t('unit.step'))}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/carte?envie=1" className="btn btn-xs">{t('planner.addStep')}</Link>
            <button
              onClick={() => {
                if (!confirmDone) {
                  setConfirmDone(true)
                  return
                }
                finishTrip()
              }}
              className={`btn btn-xs ${confirmDone ? 'btn-accent' : ''}`}
              disabled={busy}
            >
              {confirmDone ? t('planner.markDoneConfirm') : t('planner.markDone')}
            </button>
          </div>
        </div>

        {km > 0 && (
          <p className="mb-4 text-[13px] text-text-muted">
            Environ {km} km entre les etapes datees, a vol d'oiseau.
          </p>
        )}

        {steps.length === 0 ? (
          <div className="panel px-8 py-12 text-center">
            <p className="lede">{t('planner.noStepsYet')}</p>
            <Link to="/carte?envie=1" className="btn mt-6">{t('map.addWish')}</Link>
          </div>
        ) : (
          <ol className="space-y-px overflow-hidden rounded-2xl border border-line bg-line">
            {steps.map((step, i) => (
              <StepRow
                key={step.id}
                step={step}
                index={i}
                total={steps.length}
                color={categoryOf(step)?.color ?? null}
                categoryName={categoryOf(step)?.name ?? null}
                busy={busy}
                onMove={move}
                onDate={(date) => void run(() => edit(step.id, { visit_date: date || null }))}
              />
            ))}
          </ol>
        )}
      </section>

      {/* Pense-bete */}
      <section>
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <p className="eyebrow">{t('planner.checklist')}</p>
            <h2 className="display-sm mt-2 text-2xl">
              {checklist.length > 0 ? `${doneCount} sur ${checklist.length}` : t('planner.checklistEmpty')}
            </h2>
          </div>
        </div>

        <div className="panel p-5">
          <div className="flex gap-2">
            <input
              className="field"
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newItem.trim()) {
                  setChecklist([
                    ...checklist,
                    { id: crypto.randomUUID(), text: newItem.trim(), done: false },
                  ])
                  setNewItem('')
                }
              }}
              placeholder={t('planner.checklistPlaceholder')}
            />
            <button
              className="btn"
              disabled={!newItem.trim() || busy}
              onClick={() => {
                setChecklist([
                  ...checklist,
                  { id: crypto.randomUUID(), text: newItem.trim(), done: false },
                ])
                setNewItem('')
              }}
            >{t('common.add')}</button>
          </div>

          {checklist.length > 0 && (
            <ul className="mt-4 space-y-1.5">
              {checklist.map((item) => (
                <li key={item.id} className="flex items-center gap-3">
                  <button
                    onClick={() =>
                      setChecklist(
                        checklist.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)),
                      )
                    }
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[10px] transition-colors ${
                      item.done
                        ? 'border-accent bg-accent text-accent-ink'
                        : 'border-line-strong text-transparent'
                    }`}
                    aria-label={item.done ? t('planner.uncheck') : t('planner.check')}
                  >
                    ✓
                  </button>
                  <span
                    className={`min-w-0 flex-1 text-[14px] ${
                      item.done ? 'text-text-muted line-through' : ''
                    }`}
                  >
                    {item.text}
                  </span>
                  <button
                    onClick={() => setChecklist(checklist.filter((i) => i.id !== item.id))}
                    className="btn btn-xs btn-quiet"
                    aria-label={t('common.remove')}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}

function StepRow({
  step,
  index,
  total,
  color,
  categoryName,
  busy,
  onMove,
  onDate,
}: {
  step: Place
  index: number
  total: number
  color: string | null
  categoryName: string | null
  busy: boolean
  onMove: (index: number, delta: number) => void
  onDate: (date: string) => void
}) {
  const t = useT()
  return (
    <li className="flex flex-wrap items-center gap-3 bg-bg px-4 py-3.5 sm:px-5">
      <span className="display-sm w-7 shrink-0 text-center text-lg text-text-muted">
        {index + 1}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          {color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />}
          <span className="display-sm truncate text-lg">{step.name}</span>
          {step.status === 'wishlist' && (
            <span className="shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[10px] text-text-muted">{t('unit.wish')}</span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-[13px] text-text-muted">
          {step.city ? `${step.city}, ` : ''}
          {step.country}
          {categoryName && ` · ${categoryName}`}
        </span>
      </span>

      <input
        type="date"
        className="field w-auto shrink-0 py-1.5 text-[12px]"
        value={step.visit_date ?? ''}
        onChange={(e) => onDate(e.target.value)}
        title={step.visit_date ? `Prevu le ${formatDate(step.visit_date)}` : t('trips.noStep')}
      />

      <span className="flex shrink-0 gap-1">
        <button
          onClick={() => onMove(index, -1)}
          className="btn btn-xs btn-quiet"
          disabled={busy || index === 0}
          aria-label={t('planner.moveUp')}
        >
          ↑
        </button>
        <button
          onClick={() => onMove(index, 1)}
          className="btn btn-xs btn-quiet"
          disabled={busy || index === total - 1}
          aria-label={t('planner.moveDown')}
        >
          ↓
        </button>
      </span>
    </li>
  )
}
