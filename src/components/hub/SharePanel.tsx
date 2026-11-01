import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { errorMessage } from '../../lib/errors'
import { inviteToTrip, removeFromTrip } from '../../lib/tripApi'
import type { Trip } from '../../lib/types'
import type { TripHub } from '../../lib/useTripHub'
import { useT } from '../../i18n/I18nContext'
import { Avatar } from '../AppShell'

/** Inviter l'autre compte sur ce voyage, voir qui en fait partie. */
export default function SharePanel({
  trip,
  hub,
  onLeft,
}: {
  trip: Trip
  hub: TripHub
  onLeft: () => void
}) {
  const t = useT()
  const { user } = useAuth()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const isOwner = trip.user_id === user?.id

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setBusy(true)
    setMessage(null)
    try {
      const name = await inviteToTrip(trip.id, email.trim())
      setMessage({ ok: true, text: t('share.invited', { name }) })
      setEmail('')
      await hub.reload()
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel space-y-6 p-5 sm:p-7">
      <div>
        <p className="eyebrow eyebrow-dot">{t('share.title')}</p>
        <p className="lede mt-3 max-w-xl text-[15px]">{t('share.intro')}</p>
      </div>

      <ul className="space-y-2">
        {hub.people.map((p) => (
          <li key={p.user_id} className="flex items-center gap-3 rounded-2xl bg-surface-2 px-3 py-2.5">
            <Avatar url={p.avatar_url} name={p.display_name} size={36} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold">
                {p.display_name}
                {p.user_id === user?.id && <span className="font-normal text-text-muted"> ({t('share.you')})</span>}
              </p>
              <p className="text-[12px] text-text-muted">{p.is_owner ? t('share.owner') : t('share.member')}</p>
            </div>
            {!p.is_owner && (isOwner || p.user_id === user?.id) && (
              <button
                className="btn btn-quiet btn-xs"
                onClick={async () => {
                  try {
                    await removeFromTrip(trip.id, p.user_id)
                    if (p.user_id === user?.id) onLeft()
                    else await hub.reload()
                  } catch (err) {
                    setMessage({ ok: false, text: errorMessage(err) })
                  }
                }}
              >
                {p.user_id === user?.id ? t('share.leave') : t('share.remove')}
              </button>
            )}
          </li>
        ))}
      </ul>

      {isOwner && (
        <form onSubmit={invite} className="flex flex-col gap-2 sm:flex-row">
          <input
            type="email"
            className="field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('share.email')}
            autoComplete="off"
          />
          <button type="submit" className="btn btn-accent" disabled={busy || !email.trim()}>
            {t('share.invite')}
          </button>
        </form>
      )}

      {message && <p className={`notice ${message.ok ? '' : 'notice-bad'}`}>{message.text}</p>}
    </div>
  )
}
