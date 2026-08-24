import { useState } from 'react'
import { usePlaces } from '../context/PlacesContext'
import { errorMessage } from '../lib/errors'
import type { Category } from '../lib/types'

const PALETTE = [
  '#c4653d',
  '#7f8f7a',
  '#3f8fa3',
  '#9a6ea8',
  '#c9a227',
  '#8a7a68',
  '#b1552c',
  '#4f7a5e',
]

/** Creation, renommage, recoloration et suppression des categories. */
export default function CategoryManager() {
  const { categories, places, addCategory, editCategory, removeCategory, seedDefaultCategories } =
    usePlaces()
  const [name, setName] = useState('')
  const [color, setColor] = useState(PALETTE[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      const raw = errorMessage(err)
      // 23505 : l'index unique sur (user_id, lower(name))
      setError(
        raw.includes('categories_user_name_key') || raw.includes('duplicate key')
          ? 'Une categorie porte deja ce nom.'
          : raw,
      )
    } finally {
      setBusy(false)
    }
  }

  const countOf = (id: string) => places.filter((p) => p.category_id === id).length

  return (
    <div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-40 flex-1">
          <label className="label">Nouvelle categorie</label>
          <input
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) {
                void run(async () => {
                  await addCategory(name.trim(), color)
                  setName('')
                })
              }
            }}
            placeholder="Randonnee, cafe, point de vue..."
          />
        </div>
        <Swatches value={color} onChange={setColor} />
        <button
          onClick={() =>
            void run(async () => {
              await addCategory(name.trim(), color)
              setName('')
            })
          }
          className="btn btn-accent"
          disabled={busy || !name.trim()}
        >
          Ajouter
        </button>
      </div>

      {error && <p className="notice notice-bad mt-3">{error}</p>}

      {categories.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-line px-4 py-6 text-center">
          <p className="text-[13px] text-text-muted">Aucune categorie pour l'instant.</p>
          <button
            onClick={() => void run(seedDefaultCategories)}
            className="btn btn-xs mt-3"
            disabled={busy}
          >
            Partir d'une liste de base
          </button>
        </div>
      ) : (
        <ul className="mt-5 space-y-2">
          {categories.map((cat) => (
            <li key={cat.id} className="rounded-xl border border-line bg-surface-2 px-3 py-2.5">
              {editingId === cat.id ? (
                <EditRow
                  category={cat}
                  busy={busy}
                  onCancel={() => setEditingId(null)}
                  onSave={(patch) =>
                    void run(async () => {
                      await editCategory(cat.id, patch)
                      setEditingId(null)
                    })
                  }
                />
              ) : (
                <div className="flex items-center gap-3">
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ background: cat.color }}
                  />
                  <span className="min-w-0 flex-1 truncate text-[14px]">{cat.name}</span>
                  <span className="shrink-0 text-[12px] text-text-muted">
                    {countOf(cat.id)} lieu{countOf(cat.id) > 1 ? 'x' : ''}
                  </span>
                  <button onClick={() => setEditingId(cat.id)} className="btn btn-xs btn-quiet">
                    Modifier
                  </button>
                  <button
                    onClick={() => {
                      if (confirmId !== cat.id) {
                        setConfirmId(cat.id)
                        return
                      }
                      void run(async () => {
                        await removeCategory(cat.id)
                        setConfirmId(null)
                      })
                    }}
                    className={`btn btn-xs ${
                      confirmId === cat.id ? 'border-red-500/60 text-red-400' : 'btn-quiet'
                    }`}
                    disabled={busy}
                  >
                    {confirmId === cat.id ? 'Confirmer' : 'Supprimer'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-text-muted">
        Supprimer une categorie ne supprime aucun lieu : ceux qui la portaient se retrouvent
        simplement sans categorie.
      </p>
    </div>
  )
}

function EditRow({
  category,
  busy,
  onSave,
  onCancel,
}: {
  category: Category
  busy: boolean
  onSave: (patch: { name: string; color: string }) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(category.name)
  const [color, setColor] = useState(category.color)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        className="field min-w-32 flex-1"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <Swatches value={color} onChange={setColor} />
      <button
        onClick={() => onSave({ name: name.trim() || category.name, color })}
        className="btn btn-xs btn-accent"
        disabled={busy}
      >
        Enregistrer
      </button>
      <button onClick={onCancel} className="btn btn-xs btn-quiet">
        Annuler
      </button>
    </div>
  )
}

function Swatches({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex shrink-0 gap-1.5">
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={`Couleur ${c}`}
          className={`h-6 w-6 rounded-full border transition-transform ${
            value === c ? 'scale-110 border-text' : 'border-line'
          }`}
          style={{ background: c }}
        />
      ))}
    </div>
  )
}
