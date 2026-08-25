import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { errorMessage } from '../lib/errors'
import ThemeToggle from '../components/ThemeToggle'
import { useT } from '../i18n/I18nContext'

/**
 * Ecran d'arrivee du lien de reinitialisation. Supabase ouvre une session de
 * recuperation en lisant le jeton dans l'URL, il n'y a donc rien a decoder
 * ici : si une session existe, le nouveau mot de passe peut etre pose.
 */
export default function PasswordPage() {
  const { session, loading, changePassword } = useAuth()
  const t = useT()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!done) return
    const id = setTimeout(() => navigate('/'), 1800)
    return () => clearTimeout(id)
  }, [done, navigate])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 6) {
      setError(t('auth.passwordShort'))
      return
    }
    if (password !== confirm) {
      setError(t('auth.passwordsDiffer'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await changePassword(password)
      setDone(true)
    } catch (err) {
      setError(errorMessage(err))
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
        <div className="mb-9 text-center">
          <span className="mx-auto mb-7 flex h-16 w-12 items-end justify-center rounded-t-full border border-line bg-surface-2 pb-3">
            <span className="h-2 w-2 rotate-45 border border-accent" />
          </span>
          <h1 className="display text-[clamp(2rem,8vw,2.8rem)]">{t('auth.newPassword')}</h1>
        </div>

        <div className="panel p-7">
          {loading ? (
            <p className="text-[13px] text-text-muted">{t('auth.checkingLink')}</p>
          ) : done ? (
            <p className="notice">{t('auth.passwordUpdated')}</p>
          ) : !session ? (
            <div className="space-y-4">
              <p className="notice notice-bad">{t('auth.linkExpired')}</p>
              <Link to="/login" className="btn w-full">
                {t('auth.backToSignIn')}
              </Link>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="label">{t('auth.newPassword')}</label>
                <input
                  className="field"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="label">{t('auth.confirmPassword')}</label>
                <input
                  className="field"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  minLength={6}
                  required
                />
              </div>

              {error && <p className="notice notice-bad">{error}</p>}

              <button type="submit" className="btn btn-accent w-full py-3" disabled={busy}>
                {busy ? t('common.saving') : t('common.save')}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
