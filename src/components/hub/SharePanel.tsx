import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { addCompanion, fetchCompanions } from '../../lib/companions'
import type { Companion } from '../../lib/companions'
import { errorMessage } from '../../lib/errors'
import { inviteToTrip, removeFromTrip } from '../../lib/tripApi'
import type { Trip } from '../../lib/types'
import type { TripHub } from '../../lib/useTripHub'
import { useT } from '../../i18n/I18nContext'
import { Avatar } from '../AppShell'

/**
 * Voyager ensemble, en fenetre : qui est dans le voyage, les compagnons de
 * voyage a ajouter en un tap, et l'invitation par email en dernier recours.
 */
export default function SharePanel({
  trip,
  hub,
  onLeft,
  onClose,
}: {
  trip: Trip
  hub: TripHub
  onLeft: () => void
  onClose: () => void
}) {
  const t = useT()
  const { user } = useAuth()
  const [companions, setCompanions] = useState<Companion[]>([])
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string; noAccount?: boolean } | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const isOwner = trip.user_id === user?.id

  useEffect(() => {
    void fetchCompanions().then(setCompanions).catch(() => undefined)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const inTrip = new Set(hub.people.map((p) => p.user_id))
  const suggestions = companions.filter((c) => !inTrip.has(c.user_id))

  async function run(key: string, action: () => Promise<string | void>) {
    setBusy(key)
    setMessage(null)
    try {
      const name = await action()
      if (name) setMessage({ ok: true, text: t('sh.added', { name }) })
      await hub.reload()
    } catch (err) {
      const text = errorMessage(err)
      setMessage({ ok: false, text: /aucun compte|no account/i.test(text) ? t('sh.noAccount') : text, noAccount: /aucun compte/i.test(text) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="fixed inset-0 z-[1300] flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        className="panel-enter max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-[30px] bg-bg p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-[var(--shadow-lg)] sm:rounded-[30px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line-strong sm:hidden" />
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[1.6rem] font-extrabold">{t('sh.title')}</h2>
          <button onClick={onClose} className="btn btn-quiet btn-xs">
            {t('common.close')}
          </button>
        </div>
        <p className="mt-1 text-[14px] leading-snug text-text-muted">{t('sh.lede')}</p>

        {/* Dans ce voyage */}
        <p className="eyebrow mb-2 mt-6">{t('sh.people')}</p>
        <ul className="overflow-hidden rounded-[22px] border border-line bg-surface">
          {hub.people.map((p) => {
            const me = p.user_id === user?.id
            const canRemove = !p.is_owner && (isOwner || me)
            return (
              <li key={p.user_id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
                <Avatar url={p.avatar_url} name={p.display_name} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-bold">
                    {p.display_name}
                    {me && <span className="font-normal text-text-muted"> ({t('share.you')})</span>}
                  </p>
                  <p className="text-[12px] text-text-muted">{p.is_owner ? `👑 ${t('share.owner')}` : `🎒 ${t('share.member')}`}</p>
                </div>
                {canRemove && (
                  <button
                    onClick={() => {
                      if (confirm !== p.user_id) return setConfirm(p.user_id)
                      setConfirm(null)
                      void run(p.user_id, async () => {
                        await removeFromTrip(trip.id, p.user_id)
                        if (me) onLeft()
                      })
                    }}
                    disabled={busy !== null}
                    className={`btn btn-xs ${confirm === p.user_id ? 'border-red-500/60 text-red-500' : 'btn-quiet'}`}
                  >
                    {confirm === p.user_id ? t('sh.removeConfirm') : me ? t('share.leave') : t('share.remove')}
                  </button>
                )}
              </li>
            )
          })}
        </ul>

        {/* Compagnons : un tap */}
        {isOwner && suggestions.length > 0 && (
          <>
            <p className="eyebrow mb-2 mt-6">{t('sh.companions')}</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((c) => (
                <button
                  key={c.user_id}
                  onClick={() => void run(c.user_id, async () => {
                    await addCompanion(trip.id, c.user_id)
                    return c.display_name
                  })}
                  disabled={busy !== null}
                  className="flex items-center gap-2 rounded-full border border-line bg-surface py-1.5 pl-1.5 pr-4 shadow-[var(--shadow-sm)]"
                >
                  <Avatar url={c.avatar_url} name={c.display_name} size={30} />
                  <span className="text-[14px] font-bold">{busy === c.user_id ? '…' : `+ ${c.display_name}`}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Email */}
        {isOwner && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!email.trim()) return
              void run('email', async () => {
                const name = await inviteToTrip(trip.id, email.trim())
                setEmail('')
                return name
              })
            }}
            className="mt-6"
          >
            <p className="eyebrow mb-2">{t('sh.byEmail')}</p>
            <div className="flex gap-2">
              <input
                type="email"
                inputMode="email"
                autoCapitalize="none"
                className="field"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('sh.emailPh')}
              />
              <button type="submit" className="btn btn-accent" disabled={busy !== null || !email.trim()}>
                {busy === 'email' ? '…' : t('share.invite')}
              </button>
            </div>
          </form>
        )}

        {message && (
          <div className={`notice mt-4 ${message.ok ? '' : 'notice-bad'}`}>
            <p>{message.text}</p>
            {message.noAccount && (
              <button
                onClick={async () => {
                  await navigator.clipboard?.writeText(window.location.origin)
                  setCopied(true)
                }}
                className="btn btn-xs mt-2"
              >
                {copied ? t('sh.linkCopied') : t('sh.copyLink')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
