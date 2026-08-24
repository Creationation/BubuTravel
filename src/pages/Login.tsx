import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

type Mode = 'signin' | 'signup'

export default function Login() {
  const { session, signIn, signUp } = useAuth()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  if (session) return <Navigate to="/" replace />

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setBusy(true)
    try {
      if (mode === 'signin') {
        await signIn(email, password)
      } else {
        const { needsConfirm } = await signUp(email, password, displayName.trim())
        if (needsConfirm) {
          setInfo('Compte cree. Ouvrez le lien de confirmation recu par email, puis connectez-vous.')
          setMode('signin')
        }
      }
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-7 text-center">
          <span className="card-soft mb-5 inline-flex h-16 w-16 items-center justify-center bg-pink text-3xl">
            <span aria-hidden>✈</span>
          </span>
          <h1 className="font-display text-5xl leading-none">BuBuTravel</h1>
          <p className="mt-3 text-sm text-muted">
            Le carnet de nos voyages, pays par pays, photo par photo.
          </p>
        </div>

        <div className="card p-6 sm:p-7">
          <div className="mb-6 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode('signin')}
              className={`btn ${mode === 'signin' ? 'btn-dark' : ''}`}
            >
              Connexion
            </button>
            <button
              type="button"
              onClick={() => setMode('signup')}
              className={`btn ${mode === 'signup' ? 'btn-dark' : ''}`}
            >
              Creer un compte
            </button>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            {mode === 'signup' && (
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide">
                  Prenom ou pseudo
                </span>
                <input
                  className="field"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Diego"
                  required
                />
              </label>
            )}

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide">
                Email
              </span>
              <input
                className="field"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@exemple.com"
                required
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide">
                Mot de passe
              </span>
              <input
                className="field"
                type="password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
              />
            </label>

            {error && <p className="tag-alert">{error}</p>}
            {info && <p className="tag-info">{info}</p>}

            <button type="submit" className="btn btn-primary w-full py-3 text-base" disabled={busy}>
              {busy ? 'Un instant...' : mode === 'signin' ? 'Se connecter' : 'Creer le compte'}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-xs text-muted">
          Chaque compte ne voit que ses propres lieux et ses propres photos.
        </p>
      </div>
    </div>
  )
}

function messageFor(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (raw.includes('Invalid login credentials')) return 'Email ou mot de passe incorrect.'
  if (raw.includes('Email not confirmed')) return 'Compte pas encore confirme, verifiez vos emails.'
  if (raw.includes('User already registered')) return 'Un compte existe deja avec cet email.'
  if (raw.includes('Password should be')) return 'Mot de passe trop court, 6 caracteres minimum.'
  return raw
}
