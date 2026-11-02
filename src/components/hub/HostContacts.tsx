import { useState } from 'react'
import type { StopHost } from '../../lib/types'
import { useT } from '../../i18n/I18nContext'

export const EMPTY_HOST: StopHost = { stay: '', name: '', phone: '', email: '', note: '' }

const digits = (phone: string) => phone.replace(/[^\d+]/g, '')

/**
 * Contacts des hotes d'une etape : un tap pour appeler, WhatsApp ou ecrire.
 * Avec `onSave`, chaque carte se modifie sur place (bouton Modifier, ou le
 * rappel rouge « contact a ajouter ») : nom, telephone, email, note.
 */
export function HostCards({
  hosts,
  compact = false,
  onSave,
}: {
  hosts: StopHost[] | null | undefined
  compact?: boolean
  onSave?: (next: StopHost[]) => Promise<void>
}) {
  const t = useT()
  const all = hosts ?? []
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState<StopHost>(EMPTY_HOST)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const shown = all.map((h, index) => ({ h, index })).filter(({ h }) => h.stay || h.name || h.phone || h.email)
  if (shown.length === 0) return null

  function edit(index: number) {
    setDraft({ ...EMPTY_HOST, ...all[index] })
    setEditing(index)
    setError(null)
  }

  async function save() {
    if (editing === null || !onSave) return
    setBusy(true)
    setError(null)
    try {
      await onSave(all.map((h, i) => (i === editing ? { ...draft, name: draft.name.trim(), phone: draft.phone.trim(), email: draft.email.trim(), stay: draft.stay.trim(), note: draft.note.trim() } : h)))
      setEditing(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={compact ? 'space-y-2' : 'mt-3 space-y-2'}>
      {shown.map(({ h, index }) => {
        const missing = !h.phone && !h.email
        if (editing === index) {
          const set = (patch: Partial<StopHost>) => setDraft((d) => ({ ...d, ...patch }))
          return (
            <div key={index} className="fade-in space-y-2 rounded-2xl border-2 border-accent/50 bg-surface p-3.5">
              <p className="text-[14px] font-extrabold">🔑 {draft.stay || t('host.stay')}</p>
              <label className="block">
                <span className="label">{t('host.stayPh')}</span>
                <input className="field" value={draft.stay} onChange={(e) => set({ stay: e.target.value })} />
              </label>
              <label className="block">
                <span className="label">{t('host.namePh')}</span>
                <input className="field" value={draft.name} onChange={(e) => set({ name: e.target.value })} autoComplete="off" />
              </label>
              <label className="block">
                <span className="label">{t('host.phonePh')}</span>
                <input className="field" type="tel" inputMode="tel" value={draft.phone} onChange={(e) => set({ phone: e.target.value })} />
              </label>
              <label className="block">
                <span className="label">{t('host.emailPh')}</span>
                <input className="field" type="email" inputMode="email" value={draft.email} onChange={(e) => set({ email: e.target.value })} />
              </label>
              <label className="block">
                <span className="label">{t('host.notePh')}</span>
                <input className="field" value={draft.note} onChange={(e) => set({ note: e.target.value })} />
              </label>
              {error && <p className="notice notice-bad">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button onClick={() => void save()} disabled={busy} className="btn btn-accent flex-1">
                  {busy ? t('common.saving') : t('common.save')}
                </button>
                <button onClick={() => setEditing(null)} disabled={busy} className="btn">
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          )
        }
        return (
          <div key={index} className="rounded-2xl border border-line bg-surface p-3.5">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--halo)] text-xl">🔑</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-bold">{h.stay || t('host.stay')}</p>
                <p className="text-[13px] text-text-muted">{h.name ? t('host.named', { name: h.name }) : t('host.noName')}</p>
                {h.note && <p className="mt-1 text-[12px] text-text-muted">{h.note}</p>}
              </div>
              {onSave && (
                <button onClick={() => edit(index)} className="btn btn-xs shrink-0">
                  ✏️ {t('common.edit')}
                </button>
              )}
            </div>
            {missing ? (
              onSave ? (
                <button onClick={() => edit(index)} className="mt-2.5 w-full rounded-xl border border-dashed border-[#b4533f]/60 px-3 py-2.5 text-left text-[13px] font-semibold text-[#b4533f] active:scale-[0.98]">
                  ＋ {t('host.missing')}
                </button>
              ) : (
                <p className="mt-2.5 text-[12px] font-semibold text-[#b4533f]">{t('host.missing')}</p>
              )
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {h.phone && (
                  <a href={`tel:${digits(h.phone)}`} className="btn btn-xs">
                    📞 {t('host.call')}
                  </a>
                )}
                {h.phone && (
                  <a href={`https://wa.me/${digits(h.phone).replace(/^\+/, '')}`} target="_blank" rel="noreferrer" className="btn btn-xs">
                    💬 WhatsApp
                  </a>
                )}
                {h.email && (
                  <a href={`mailto:${h.email}`} className="btn btn-xs">
                    ✉️ {t('host.write')}
                  </a>
                )}
              </div>
            )}
            {(h.phone || h.email) && <p className="num mt-2 text-[12px] text-text-muted">{[h.phone, h.email].filter(Boolean).join(' · ')}</p>}
          </div>
        )
      })}
    </div>
  )
}

/** Edition de la liste des hebergements et de leurs hotes. */
export function HostsEditor({ hosts, onChange }: { hosts: StopHost[]; onChange: (next: StopHost[]) => void }) {
  const t = useT()
  const update = (i: number, patch: Partial<StopHost>) => onChange(hosts.map((h, j) => (j === i ? { ...h, ...patch } : h)))
  return (
    <div className="space-y-3">
      {hosts.map((h, i) => (
        <div key={i} className="space-y-2 rounded-2xl bg-surface-2 p-3">
          <div className="flex items-center gap-2">
            <input
              className="field flex-1"
              value={h.stay}
              placeholder={t('host.stayPh')}
              onChange={(e) => update(i, { stay: e.target.value })}
            />
            <button
              type="button"
              onClick={() => onChange(hosts.filter((_, j) => j !== i))}
              className="btn btn-quiet btn-xs"
              aria-label={t('common.erase')}
            >
              ✕
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <input className="field" value={h.name} placeholder={t('host.namePh')} onChange={(e) => update(i, { name: e.target.value })} />
            <input
              className="field"
              type="tel"
              inputMode="tel"
              value={h.phone}
              placeholder={t('host.phonePh')}
              onChange={(e) => update(i, { phone: e.target.value })}
            />
            <input
              className="field"
              type="email"
              value={h.email}
              placeholder={t('host.emailPh')}
              onChange={(e) => update(i, { email: e.target.value })}
            />
          </div>
          <input className="field" value={h.note} placeholder={t('host.notePh')} onChange={(e) => update(i, { note: e.target.value })} />
        </div>
      ))}
      <button type="button" onClick={() => onChange([...hosts, { ...EMPTY_HOST }])} className="btn btn-xs">
        ＋ {t('host.add')}
      </button>
    </div>
  )
}
