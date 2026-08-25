import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ThemeToggle from '../components/ThemeToggle'
import LanguageSwitch from '../i18n/LanguageSwitch'
import { useT } from '../i18n/I18nContext'
import { errorMessage } from '../lib/errors'

type Mode = 'signin' | 'signup' | 'reset'

export default function Login() {
  const { session, signIn, signUp, sendReset } = useAuth()
  const t = useT()
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
      if (mode === 'reset') {
        await sendReset(email)
        setInfo(t('auth.resetSent'))
        setMode('signin')
      } else if (mode === 'signin') {
        await signIn(email, password)
      } else {
        const { needsConfirm } = await signUp(email, password, displayName.trim())
        if (needsConfirm) {
          setInfo(t('auth.confirmSent'))
          setMode('signin')
        }
      }
    } catch (err) {
      setError(messageFor(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative flex min-h-full items-center justify-center px-5 py-14">
      <div className="absolute right-5 top-5 flex items-center gap-2">
        <LanguageSwitch compact />
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          <span className="mx-auto mb-7 flex h-16 w-12 items-end justify-center rounded-t-full border border-line bg-surface-2 pb-3">
            <span className="h-2 w-2 rotate-45 border border-accent" />
          </span>
          <h1 className="display text-[clamp(2.6rem,10vw,3.6rem)]">{t('app.name')}</h1>
          <p className="lede mt-4">{t('app.tagline')}</p>
        </div>

        <div className="panel p-7">
          {mode === 'reset' ? (
            <p className="mb-6 text-[13px] leading-relaxed text-text-soft">
              {t('auth.resetIntro')}
            </p>
          ) : (
            <div className="mb-6 flex gap-2">
              <button
                type="button"
                onClick={() => setMode('signin')}
                className={`pill flex-1 justify-center ${mode === 'signin' ? 'pill-active' : ''}`}
              >
                {t('auth.signIn')}
              </button>
              <button
                type="button"
                onClick={() => setMode('signup')}
                className={`pill flex-1 justify-center ${mode === 'signup' ? 'pill-active' : ''}`}
              >
                {t('auth.signUp')}
              </button>
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="label">{t('auth.displayName')}</label>
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
              <label className="label">{t('auth.email')}</label>
              <input
                className="field"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('place.emailPlaceholder')}
                required
              />
            </div>

            {mode !== 'reset' && (
              <div>
                <label className="label">{t('auth.password')}</label>
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
            )}

            {error && <p className="notice notice-bad">{error}</p>}
            {info && <p className="notice">{info}</p>}

            <button type="submit" className="btn btn-accent w-full py-3" disabled={busy}>
              {busy
                ? t('common.wait')
                : mode === 'signin'
                  ? t('auth.signInAction')
                  : mode === 'signup'
                    ? t('auth.signUpAction')
                    : t('auth.sendLink')}
            </button>

            <button
              type="button"
              onClick={() => {
                setError(null)
                setInfo(null)
                setMode(mode === 'reset' ? 'signin' : 'reset')
              }}
              className="block w-full text-center text-[12px] text-text-muted underline-offset-4 hover:text-text hover:underline"
            >
              {mode === 'reset' ? t('auth.backToSignIn') : t('auth.forgot')}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-[12px] text-text-muted">
          {t('auth.privacyNote')}
        </p>
      </div>
    </div>
  )
}

type Translate = ReturnType<typeof useT>

function messageFor(err: unknown, t: Translate): string {
  const raw = errorMessage(err)
  if (raw.includes('Invalid login credentials')) return t('auth.badCredentials')
  if (raw.includes('Email not confirmed')) return t('auth.notConfirmed')
  if (raw.includes('User already registered')) return t('auth.alreadyRegistered')
  if (raw.includes('Password should be')) return t('auth.passwordShort')
  if (raw.includes('rate limit') || raw.includes('Too many')) return t('auth.rateLimited')
  return raw
}
