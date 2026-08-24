import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ThemeToggle from '../components/ThemeToggle'
import { errorMessage } from '../lib/errors'

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
    <div className="relative flex min-h-full items-center justify-center px-5 py-14">
      <div className="absolute right-5 top-5">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          <span className="mx-auto mb-6 block h-2 w-2 rounded-full bg-accent" />
          <h1 className="display text-[clamp(2.6rem,10vw,3.6rem)]">BuBuTravel</h1>
          <p className="lede mt-4">Le carnet de nos voyages, pays par pays, photo par photo.</p>
        </div>

        <div className="panel p-7">
          <div className="mb-6 flex gap-2">
            <button
              type="button"
              onClick={() => setMode('signin')}
              className={`pill flex-1 justify-center ${mode === 'signin' ? 'pill-active' : ''}`}
            >
              Connexion
            </button>
            <button
              type="button"
              onClick={() => setMode('signup')}
              className={`pill flex-1 justify-center ${mode === 'signup' ? 'pill-active' : ''}`}
            >
              Creer un compte
            </button>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="label">Prenom ou pseudo</label>
                <input
                  className="field"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Diego"
                  required
                />
              </div>
            )}

            <div>
              <label className="label">Email</label>
              <input
                className="field"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@exemple.com"
                required
              />
            </div>

            <div>
              <label className="label">Mot de passe</label>
              <input
                className="field"
                type="password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
              />
            </div>

            {error && <p className="notice notice-bad">{error}</p>}
            {info && <p className="notice">{info}</p>}

            <button type="submit" className="btn btn-accent w-full py-3" disabled={busy}>
              {busy ? 'Un instant...' : mode === 'signin' ? 'Se connecter' : 'Creer le compte'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-[12px] text-text-muted">
          Chaque compte ne voit que ses propres lieux et ses propres photos.
        </p>
      </div>
    </div>
  )
}

function messageFor(err: unknown): string {
  const raw = errorMessage(err)
  if (raw.includes('Invalid login credentials')) return 'Email ou mot de passe incorrect.'
  if (raw.includes('Email not confirmed')) return 'Compte pas encore confirme, verifiez vos emails.'
  if (raw.includes('User already registered')) return 'Un compte existe deja avec cet email.'
  if (raw.includes('Password should be')) return 'Mot de passe trop court, 6 caracteres minimum.'
  return raw
}
