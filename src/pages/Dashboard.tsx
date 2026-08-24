import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePlaces } from '../context/PlacesContext'
import { updateDisplayName, uploadAvatar } from '../lib/api'

const STAT_COLORS = ['bg-pink', 'bg-yellow', 'bg-violet']

export default function Dashboard() {
  const { user, profile, signOut, refreshProfile } = useAuth()
  const { places, countries, loading, error } = usePlaces()
  const fileRef = useRef<HTMLInputElement>(null)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [busy, setBusy] = useState(false)

  const name = profile?.display_name || user?.email?.split('@')[0] || 'Voyageur'
  const lastVisit = places.find((p) => p.visit_date)?.visit_date ?? null

  async function onAvatar(file: File | undefined) {
    if (!file || !user) return
    setBusy(true)
    try {
      await uploadAvatar(user.id, file)
      await refreshProfile()
    } catch (err) {
      console.error('[dashboard] avatar', err)
    } finally {
      setBusy(false)
    }
  }

  async function saveName() {
    if (!user) return
    const next = nameInput.trim()
    if (!next) {
      setEditingName(false)
      return
    }
    setBusy(true)
    try {
      await updateDisplayName(user.id, next)
      await refreshProfile()
      setEditingName(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto min-h-full w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="card-soft flex h-11 w-11 items-center justify-center bg-pink text-xl">
            ✈
          </span>
          <span className="font-display text-3xl leading-none">BuBuTravel</span>
        </div>
        <button onClick={() => void signOut()} className="btn btn-sm">
          Deconnexion
        </button>
      </header>

      {/* Profil */}
      <section className="card mb-6 p-6 sm:p-7">
        <div className="flex flex-wrap items-center gap-6">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="group relative h-24 w-24 shrink-0 overflow-hidden rounded-full border-2 border-ink bg-pink-soft"
            style={{ boxShadow: '4px 4px 0 #000' }}
            title="Changer la photo de profil"
          >
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="font-display flex h-full w-full items-center justify-center text-4xl">
                {name.charAt(0).toUpperCase()}
              </span>
            )}
            <span className="absolute inset-0 hidden items-center justify-center bg-ink/75 text-[10px] font-semibold text-paper group-hover:flex">
              Changer
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              void onAvatar(e.target.files?.[0])
              e.target.value = ''
            }}
          />

          <div className="min-w-0 flex-1">
            {editingName ? (
              <div className="flex max-w-xs gap-2">
                <input
                  className="field"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void saveName()}
                  autoFocus
                />
                <button onClick={() => void saveName()} className="btn btn-primary" disabled={busy}>
                  OK
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setNameInput(name)
                  setEditingName(true)
                }}
                className="group text-left"
                title="Modifier le nom"
              >
                <h1 className="font-display text-4xl leading-none group-hover:text-pink sm:text-5xl">
                  {name}
                </h1>
              </button>
            )}
            <p className="mt-2 text-sm text-muted">{user?.email}</p>
          </div>

          <Link to="/carte" className="btn btn-primary py-3 text-base">
            Ouvrir la carte
          </Link>
        </div>
      </section>

      {/* Compteurs */}
      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat color={STAT_COLORS[0]} label="Pays visites" value={countries.length} />
        <Stat color={STAT_COLORS[1]} label="Lieux enregistres" value={places.length} />
        <Stat
          color={STAT_COLORS[2]}
          label="Derniere visite"
          value={lastVisit ? new Date(`${lastVisit}T00:00:00`).getFullYear() : 'à venir'}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="card p-6">
          <h2 className="mb-4 text-xs font-bold uppercase tracking-widest">Pays visites</h2>
          {loading ? (
            <p className="text-sm text-muted">Chargement...</p>
          ) : countries.length === 0 ? (
            <p className="text-sm text-muted">
              Aucun pays pour l'instant. Ajoutez un premier lieu depuis la carte.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {countries.map((country) => (
                <li key={country} className="chip">
                  {country}
                  <span className="rounded-full bg-pink px-1.5 text-[10px] font-bold">
                    {places.filter((p) => p.country === country).length}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card p-6">
          <h2 className="mb-4 text-xs font-bold uppercase tracking-widest">Derniers lieux</h2>
          {places.length === 0 ? (
            <p className="text-sm text-muted">Rien a afficher pour le moment.</p>
          ) : (
            <ul className="divide-y-2 divide-ink/10">
              {places.slice(0, 6).map((place) => (
                <li key={place.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                  <Link to="/carte" className="truncate font-medium hover:text-pink">
                    {place.name}
                    <span className="text-muted">, {place.country}</span>
                  </Link>
                  <span className="shrink-0 text-xs text-muted">
                    {place.visit_date
                      ? new Date(`${place.visit_date}T00:00:00`).toLocaleDateString('fr-FR')
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {error && <p className="tag-alert mt-6">{error}</p>}
    </div>
  )
}

function Stat({
  label,
  value,
  color,
}: {
  label: string
  value: number | string
  color: string
}) {
  return (
    <div className={`card card-lift ${color} px-6 py-5`}>
      <p className="font-display text-5xl leading-none">{value}</p>
      <p className="mt-2 text-xs font-bold uppercase tracking-widest">{label}</p>
    </div>
  )
}
