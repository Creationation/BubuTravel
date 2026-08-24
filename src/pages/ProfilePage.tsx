import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { usePlaces } from '../context/PlacesContext'
import { disableShare, enableShare, fetchShare, rotateShare, updateDisplayName, uploadAvatar } from '../lib/api'
import type { PublicShare } from '../lib/types'
import AppShell, { Avatar } from '../components/AppShell'
import Reveal from '../components/Reveal'
import { useTheme } from '../context/ThemeContext'
import { errorMessage } from '../lib/errors'

export default function ProfilePage() {
  const { user, profile, refreshProfile } = useAuth()
  const { stats } = usePlaces()
  const { theme, setTheme } = useTheme()
  const fileRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [share, setShare] = useState<PublicShare | null>(null)
  const [shareBusy, setShareBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const displayName = profile?.display_name || user?.email?.split('@')[0] || 'Voyageur'

  useEffect(() => {
    setName(profile?.display_name ?? '')
  }, [profile?.display_name])

  useEffect(() => {
    if (!user) return
    fetchShare(user.id)
      .then(setShare)
      .catch((err) => setError(errorMessage(err)))
  }, [user])

  const shareUrl = share ? `${window.location.origin}/p/${share.token}` : null

  async function saveName() {
    if (!user) return
    setBusy(true)
    setError(null)
    try {
      await updateDisplayName(user.id, name.trim() || displayName)
      await refreshProfile()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function onAvatar(file: File | undefined) {
    if (!file || !user) return
    setBusy(true)
    try {
      await uploadAvatar(user.id, file)
      await refreshProfile()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function runShare(action: 'on' | 'off' | 'rotate') {
    if (!user) return
    setShareBusy(true)
    setError(null)
    try {
      if (action === 'on') setShare(await enableShare(user.id))
      if (action === 'rotate') setShare(await rotateShare(user.id))
      if (action === 'off') {
        await disableShare(user.id)
        setShare((prev) => (prev ? { ...prev, is_active: false } : prev))
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setShareBusy(false)
    }
  }

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-3xl px-5 pb-24 sm:px-8">
        <section className="border-b border-line py-12 sm:py-16">
          <Reveal>
            <p className="eyebrow">Profil</p>
            <h1 className="display mt-4 text-[clamp(2.2rem,6vw,4rem)]">{displayName}</h1>
            <p className="lede mt-4">{user?.email}</p>
          </Reveal>
        </section>

        {/* Identite */}
        <Reveal className="mt-10">
          <section className="panel p-6 sm:p-8">
            <h2 className="display-sm text-2xl">Identite</h2>

            <div className="mt-6 flex flex-wrap items-center gap-5">
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="group relative rounded-full"
                title="Changer la photo de profil"
              >
                <Avatar url={profile?.avatar_url} name={displayName} size={72} />
                <span className="absolute inset-0 hidden items-center justify-center rounded-full bg-bg-deep/70 text-[11px] text-text group-hover:flex">
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

              <div className="min-w-56 flex-1">
                <label className="label">Nom affiche</label>
                <div className="flex gap-2">
                  <input
                    className="field"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void saveName()}
                  />
                  <button onClick={() => void saveName()} className="btn" disabled={busy}>
                    {saved ? 'Enregistre' : 'Enregistrer'}
                  </button>
                </div>
              </div>
            </div>
          </section>
        </Reveal>

        {/* Apparence */}
        <Reveal className="mt-6">
          <section className="panel p-6 sm:p-8">
            <h2 className="display-sm text-2xl">Apparence</h2>
            <p className="lede mt-2 text-[14px]">
              Le theme suit votre systeme tant que vous n'avez rien choisi ici.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => setTheme('dark')}
                className={`pill ${theme === 'dark' ? 'pill-active' : ''}`}
              >
                Sombre
              </button>
              <button
                onClick={() => setTheme('light')}
                className={`pill ${theme === 'light' ? 'pill-active' : ''}`}
              >
                Clair
              </button>
            </div>
          </section>
        </Reveal>

        {/* Partage */}
        <Reveal className="mt-6">
          <section className="panel p-6 sm:p-8">
            <h2 className="display-sm text-2xl">Partage en lecture seule</h2>
            <p className="lede mt-2 text-[14px]">
              Un lien unique donne acces a une version consultable de votre carnet, sans compte et
              sans possibilite de modifier quoi que ce soit. Votre email n'y figure jamais.
            </p>

            {share?.is_active && shareUrl ? (
              <div className="mt-5 space-y-3">
                <div className="flex flex-wrap gap-2">
                  <input className="field flex-1" value={shareUrl} readOnly onFocus={(e) => e.target.select()} />
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(shareUrl)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2000)
                    }}
                    className="btn btn-accent"
                  >
                    {copied ? 'Copie' : 'Copier'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a href={shareUrl} target="_blank" rel="noreferrer" className="btn btn-xs">
                    Ouvrir le lien
                  </a>
                  <button
                    onClick={() => void runShare('rotate')}
                    className="btn btn-xs"
                    disabled={shareBusy}
                  >
                    Regenerer le lien
                  </button>
                  <button
                    onClick={() => void runShare('off')}
                    className="btn btn-xs btn-quiet"
                    disabled={shareBusy}
                  >
                    Desactiver
                  </button>
                </div>
                <p className="text-[11px] text-text-muted">
                  Regenerer coupe immediatement l'ancien lien pour tout le monde.
                </p>
              </div>
            ) : (
              <button
                onClick={() => void runShare('on')}
                className="btn btn-accent mt-5"
                disabled={shareBusy}
              >
                {shareBusy ? 'Un instant...' : 'Activer le partage'}
              </button>
            )}
          </section>
        </Reveal>

        {/* Chiffres */}
        <Reveal className="mt-6">
          <section className="panel p-6 sm:p-8">
            <h2 className="display-sm text-2xl">En chiffres</h2>
            <div className="mt-5 grid grid-cols-2 gap-5 sm:grid-cols-4">
              <Fig label="Pays" value={stats.countries} />
              <Fig label="Villes" value={stats.cities} />
              <Fig label="Lieux" value={stats.places} />
              <Fig label="Photos" value={stats.photos} />
            </div>
          </section>
        </Reveal>

        {error && <p className="notice notice-bad mt-6">{error}</p>}
      </div>
    </AppShell>
  )
}

function Fig({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="display text-3xl">{value}</p>
      <p className="eyebrow mt-1">{label}</p>
    </div>
  )
}
