import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { fetchCompanions } from '../../lib/companions'
import type { Companion } from '../../lib/companions'
import { errorMessage } from '../../lib/errors'
import { supabase } from '../../lib/supabase'
import { useI18n } from '../../i18n/I18nContext'
import { Avatar } from '../AppShell'

const db = () => supabase as unknown as { from: (t: string) => ReturnType<typeof supabase.from> }

/**
 * Avec qui le coffre est partage. Un interrupteur par personne : on peut
 * arreter de partager avec quelqu'un a tout moment (ses elements ne
 * s'affichent plus chez lui). Chaque element garde en plus son propre
 * choix « prive / partage » dans son formulaire.
 */
export default function VaultSharing({ onChange }: { onChange?: (people: Companion[]) => void }) {
  const { t } = useI18n()
  const { user } = useAuth()
  const [people, setPeople] = useState<Companion[]>([])
  const [shared, setShared] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    try {
      const list = await fetchCompanions()
      setPeople(list)
      onChange?.(list)
      const { data } = await db().from('vault_shares').select('member_id').eq('owner_id', user.id)
      setShared(new Set(((data ?? []) as unknown as { member_id: string }[]).map((r) => r.member_id)))
    } catch (err) {
      setError(errorMessage(err))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  useEffect(() => {
    void load()
  }, [load])

  async function toggle(p: Companion) {
    if (!user) return
    setBusy(p.user_id)
    setError(null)
    try {
      if (shared.has(p.user_id)) {
        const { error: err } = await db().from('vault_shares').delete().eq('owner_id', user.id).eq('member_id', p.user_id)
        if (err) throw err
      } else {
        const { error: err } = await db().from('vault_shares').insert({ member_id: p.user_id } as never)
        if (err) throw err
      }
      await load()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  if (people.length === 0) return null
  const count = people.filter((p) => shared.has(p.user_id)).length

  return (
    <section className="mt-5 rounded-[22px] border border-line bg-surface p-4">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 text-left" aria-expanded={open}>
        <span className="text-xl">👫</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-extrabold">{t('vsh.title')}</span>
          <span className="block truncate text-[12.5px] text-text-muted">
            {count === 0
              ? t('vsh.nobody')
              : t('vsh.with', { names: people.filter((p) => shared.has(p.user_id)).map((p) => p.display_name).join(', ') })}
          </span>
        </span>
        <span className={`text-text-muted transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
      </button>

      {open && (
        <div className="fade-in mt-4 space-y-2.5">
          <p className="text-[12.5px] leading-snug text-text-muted">{t('vsh.hint')}</p>
          {people.map((p) => {
            const on = shared.has(p.user_id)
            return (
              <button
                key={p.user_id}
                role="switch"
                aria-checked={on}
                disabled={busy !== null}
                onClick={() => void toggle(p)}
                className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface-2 p-3 text-left active:scale-[0.98]"
              >
                <Avatar url={p.avatar_url} name={p.display_name} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-bold">{p.display_name}</span>
                  <span className="block text-[12px] text-text-muted">{on ? t('vsh.on') : t('vsh.off')}</span>
                </span>
                <span className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-300 ${on ? 'bg-accent' : 'bg-line-strong'}`}>
                  <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all duration-300 ${on ? 'left-[1.4rem]' : 'left-0.5'}`} />
                </span>
              </button>
            )
          })}
          {error && <p className="notice notice-bad">{error}</p>}
        </div>
      )}
    </section>
  )
}
