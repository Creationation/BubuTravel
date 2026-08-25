import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { usePlaces } from '../context/PlacesContext'
import { disableShare, enableShare, fetchShare, rotateShare, updateDisplayName, uploadAvatar } from '../lib/api'
import type { PublicShare } from '../lib/types'
import AppShell, { Avatar } from '../components/AppShell'
import Reveal from '../components/Reveal'
import CategoryManager from '../components/CategoryManager'
import DataTools from '../components/DataTools'
import LanguageSwitch from '../i18n/LanguageSwitch'
import { useT } from '../i18n/I18nContext'
import { useTheme } from '../context/ThemeContext'
import { errorMessage } from '../lib/errors'

export default function ProfilePage() {
  const t = useT()
  const { user, profile, refreshProfile, changePassword } = useAuth()
  const { stats } = usePlaces()
  const { theme, setTheme } = useTheme()
  const fileRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [password, setPassword] = useState('')
  const [passwordDone, setPasswordDone] = useState(false)
  const [share, setShare] = useState<PublicShare | null>(null)
  const [shareBusy, setShareBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const displayName = profile?.display_name || user?.email?.split('@')[0] || t('common.traveller')

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

  async function savePassword() {
    if (password.length < 6) {
      setError(t('auth.passwordShort'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await changePassword(password)
      setPassword('')
      setPasswordDone(true)
      setTimeout(() => setPasswordDone(false), 2500)
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
            <p className="eyebrow">{t('nav.profile')}</p>
            <h1 className="display mt-4 text-[clamp(2.2rem,6vw,4rem)]">{displayName}</h1>
            <p className="lede mt-4">{user?.email}</p>
          </Reveal>
        </section>

        {/* Identite */}
        <Reveal className="mt-10">
          <section className="panel p-6 sm:p-8">
            <h2 className="display-sm text-2xl">{t('profile.identity')}</h2>

            <div className="mt-6 flex flex-wrap items-center gap-5">
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="group relative rounded-full"
                title={t('profile.changePhotoTitle')}
              >
                <Avatar url={profile?.avatar_url} name={displayName} size={72} />
                <span className="absolute inset-0 hidden items-center justify-center rounded-full bg-bg-deep/70 text-[11px] text-text group-hover:flex">{t('profile.changePhoto')}</span>
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
                <label className="label">{t('profile.displayName')}</label>
                <div className="flex gap-2">
                  <input
                    className="field"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void saveName()}
                  />
                  <button onClick={() => void saveName()} className="btn" disabled={busy}>
                    {saved ? t('common.saved') : t('common.save')}
                  </button>
                </div>
              </div>
            </div>
          </section>
        </Reveal>

        {/* Apparence */}
        <Reveal className="mt-6">
          <section className="panel p-6 sm:p-8">
            <h2 className="display-sm text-2xl">{t('profile.appearance')}</h2>
            <p className="lede mt-2 text-[14px]">{t('profile.themeFollows')}</p>
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => setTheme('dark')}
                className={`pill ${theme === 'dark' ? 'pill-active' : ''}`}
              >{t('profile.dark')}</button>
              <button
                onClick={() => setTheme('light')}
                className={`pill ${theme === 'light' ? 'pill-active' : ''}`}
              >{t('profile.light')}</button>
            </div>
          </section>
        </Reveal>

        {/* Langue */}
        <Reveal className="mt-6">
          <section className="panel p-6 sm:p-8">
            <h2 className="display-sm text-2xl">{t('profile.language')}</h2>
            <p className="lede mt-2 text-[14px]">{t('profile.languageHint')}</p>
            <div className="mt-5">
              <LanguageSwitch />
            </div>
          </section>
        </Reveal>

        {/* Securite */}
        <Reveal className="mt-6">
          <section className="panel p-6 sm:p-8">
            <h2 className="display-sm text-2xl">{t('auth.password')}</h2>
            <p className="lede mt-2 text-[14px]">{t('profile.passwordHint')}</p>
            <div className="mt-5 flex max-w-md flex-wrap gap-2">
              <input
                className="field min-w-48 flex-1"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('auth.newPassword')}
                minLength={6}
              />
              <button
                onClick={() => void savePassword()}
                className="btn"
                disabled={busy || password.length < 6}
              >
                {passwordDone ? t('profile.passwordChanged') : t('profile.changePhoto')}
              </button>
            </div>
          </section>
        </Reveal>

        {/* Categories */}
        <Reveal className="mt-6">
          <section className="panel p-6 sm:p-8">
            <h2 className="display-sm text-2xl">{t('common.categories')}</h2>
            <p className="lede mt-2 text-[14px]">{t('profile.categoriesHint')}</p>
            <div className="mt-6">
              <CategoryManager />
            </div>
          </section>
        </Reveal>

        {/* Partage */}
        <Reveal className="mt-6">
          <section className="panel p-6 sm:p-8">
            <h2 className="display-sm text-2xl">{t('profile.share')}</h2>
            <p className="lede mt-2 text-[14px]">{t('profile.shareHint')}</p>

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
                    {copied ? t('profile.shareCopied') : t('profile.shareCopy')}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a href={shareUrl} target="_blank" rel="noreferrer" className="btn btn-xs">{t('profile.shareOpen')}</a>
                  <button
                    onClick={() => void runShare('rotate')}
                    className="btn btn-xs"
                    disabled={shareBusy}
                  >{t('profile.shareRotate')}</button>
                  <button
                    onClick={() => void runShare('off')}
                    className="btn btn-xs btn-quiet"
                    disabled={shareBusy}
                  >{t('profile.shareDisable')}</button>
                </div>
                <p className="text-[11px] text-text-muted">{t('profile.shareRotateHint')}</p>
              </div>
            ) : (
              <button
                onClick={() => void runShare('on')}
                className="btn btn-accent mt-5"
                disabled={shareBusy}
              >
                {shareBusy ? t('common.wait') : t('profile.shareEnable')}
              </button>
            )}
          </section>
        </Reveal>

        {/* Sauvegarde */}
        <Reveal className="mt-6">
          <section className="panel p-6 sm:p-8">
            <h2 className="display-sm text-2xl">{t('profile.backup')}</h2>
            <p className="lede mt-2 text-[14px]">{t('profile.backupHint')}</p>
            <div className="mt-6">
              <DataTools />
            </div>
          </section>
        </Reveal>

        {/* Chiffres */}
        <Reveal className="mt-6">
          <section className="panel p-6 sm:p-8">
            <h2 className="display-sm text-2xl">{t('profile.figures')}</h2>
            <div className="mt-5 grid grid-cols-2 gap-5 sm:grid-cols-4">
              <Fig label={t('common.country')} value={stats.countries} />
              <Fig label={t('stat.cities')} value={stats.cities} />
              <Fig label={t('profile.places')} value={stats.places} />
              <Fig label={t('common.photos')} value={stats.photos} />
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
