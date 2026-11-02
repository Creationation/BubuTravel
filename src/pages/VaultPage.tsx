import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import AppShell from '../components/AppShell'
import PinGate, { lockVault } from '../components/vault/PinGate'
import { useAuth } from '../context/AuthContext'
import { usePlaces } from '../context/PlacesContext'
import { pickCurrentTrip } from '../lib/currentTrip'
import { errorMessage } from '../lib/errors'
import { fetchDocuments, fetchStops, openDocumentUrl, updateStop } from '../lib/tripApi'
import { addDaysIso, shortDate, todayIso } from '../lib/tripDates'
import type { StopHost, TripDocument } from '../lib/types'
import { HostCards } from '../components/hub/HostContacts'
import {
  cacheUrl,
  cachedUrl,
  cacheVaultOffline,
  loadLocal,
  saveVaultLocal,
  deleteVaultItem,
  fetchVault,
  saveVaultItem,
  vaultFileUrls,
} from '../lib/vault'
import type { VaultInput, VaultItem, VaultKind } from '../lib/vault'
import { useI18n } from '../i18n/I18nContext'
import type { Key } from '../i18n/fr'
import { PlusIcon } from '../components/hub/icons'
import Lightbox from '../components/Lightbox'
import Portal from '../components/Portal'
import VaultSharing from '../components/vault/VaultSharing'
import type { Companion } from '../lib/companions'
import EditButton from '../components/EditButton'
import { useAiJobs } from '../context/AiJobsContext'

const KINDS: VaultKind[] = ['identity', 'card', 'ticket', 'insurance', 'contact', 'other']

/**
 * Coffre personnel, derriere un code a 5 chiffres : la copie de secours de
 * tout ce qu'on ne veut pas perdre en voyage.
 */
export default function VaultPage() {
  const { t } = useI18n()
  // ?changer=1 : on vient des reglages pour changer le code
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [changing, setChanging] = useState(params.get('changer') === '1')
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-3xl px-5 pb-28 sm:px-8">
        <h1 className="sr-only">{t('vault.title')}</h1>
        <PinGate
          key={changing ? 'change' : 'gate'}
          change={changing}
          onChanged={() => {
            setChanging(false)
            navigate('/coffre', { replace: true })
          }}
        >
          <Vault onChangePin={() => setChanging(true)} />
        </PinGate>
      </div>
    </AppShell>
  )
}

function Vault({ onChangePin }: { onChangePin: () => void }) {
  const { t, locale, lang } = useI18n()
  const { user } = useAuth()
  const { trips } = usePlaces()
  const [items, setItems] = useState<VaultItem[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<VaultItem | VaultKind | null>(null)
  const [viewer, setViewer] = useState<{ urls: string[]; index: number } | null>(null)
  const [tripDocs, setTripDocs] = useState<TripDocument[]>([])
  const [people, setPeople] = useState<Companion[]>([])
  const [sosMsg, setSosMsg] = useState<string | null>(null)
  const { queue: queueAi } = useAiJobs()
  const [offline, setOffline] = useState<{ ready: number; total: number } | null>(null)
  const [hosts, setHosts] = useState<{ stopId: string; stop: string; dates: string; hosts: StopHost[] }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [, forceLock] = useState(0)

  const reload = useCallback(async () => {
    try {
      const list = await fetchVault()
      setItems(list)
      setUrls(await vaultFileUrls(list.flatMap((i) => i.files)))
      // Copie hors ligne automatique : seuls les fichiers manquants descendent
      const total = new Set(list.flatMap((i) => i.files)).size
      setOffline({ ready: await cacheVaultOffline(list).catch(() => 0), total })
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    void reload()
    const trip = pickCurrentTrip(trips)
    // Hors ligne : on relit la derniere copie gardee sur l'appareil
    setTripDocs(loadLocal<TripDocument[]>('docs') ?? [])
    setHosts(loadLocal<typeof hosts>('hosts') ?? [])
    if (!trip || !navigator.onLine) return
    void fetchDocuments(trip.id)
      .then((d) => {
        const docs = d.filter((x) => ['flight', 'stay', 'transport', 'insurance'].includes(x.kind))
        setTripDocs(docs)
        saveVaultLocal('docs', docs)
        for (const doc of docs) if (doc.path) void cacheUrl(doc.id, () => openDocumentUrl(doc))
      })
      .catch(() => undefined)
    void fetchStops(trip.id)
      .then((stops) => {
        const list = stops
          .filter((st) => (st.hosts ?? []).length > 0)
          .map((st) => ({
            stopId: st.id,
            stop: st.name,
            dates: [st.arrive_date, st.leave_date].filter(Boolean).map((d) => shortDate(d!, locale)).join(' → '),
            hosts: st.hosts,
          }))
        setHosts(list)
        saveVaultLocal('hosts', list)
      })
      .catch(() => undefined)
  }, [reload, trips, locale])

  return (
    <div className="pt-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="display text-[2.4rem]">{t('vault.title')}</h1>
          <p className="mt-2 max-w-md text-[15px] leading-snug text-text-muted">{t('vault.lede')}</p>
        </div>
        <button
          onClick={() => {
            lockVault()
            forceLock((n) => n + 1)
            window.location.reload()
          }}
          className="btn btn-xs shrink-0"
        >
          🔒 {t('vault.lock')}
        </button>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <span
          className={`chip ${offline && offline.ready >= offline.total ? 'chip-accent' : ''}`}
          title={t('vault.offlineHint')}
        >
          {!offline
            ? `⏳ ${t('vault.offlineSync')}`
            : offline.ready >= offline.total
              ? `✅ ${t('vault.offlineReady')}`
              : `⏳ ${t('vault.offlinePartial', { n: offline.ready, total: offline.total })}`}
        </span>
        <button onClick={onChangePin} className="btn btn-quiet btn-xs">
          {t('vault.pin.change')}
        </button>
      </div>
      {error && <p className="notice notice-bad mt-4">{error}</p>}

      <VaultSharing onChange={setPeople} />

      <button
        onClick={async () => {
          const trip = pickCurrentTrip(trips)
          if (!trip) return
          setSosMsg('…')
          const stops = await fetchStops(trip.id).catch(() => [])
          const list = [...new Set(stops.map((s) => s.country).filter(Boolean) as string[])]
          for (const country of list) await queueAi('emergency', { country, lang }, trip.id).catch(() => undefined)
          setSosMsg(t('sos.started', { n: list.length }))
        }}
        className="btn btn-xs mt-3"
      >
        🚨 {t('sos.refresh')}
      </button>
      {sosMsg && <p className="mt-2 text-[12.5px] text-text-muted">{sosMsg}</p>}

      <div className="mt-8 space-y-8">
        {KINDS.map((kind) => {
          const list = items.filter((i) => i.kind === kind)
          return (
            <section key={kind}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[1.25rem] font-extrabold">{t(`vault.kind.${kind}` as Key)}</h2>
                <button onClick={() => setEditing(kind)} className="btn btn-xs">
                  <PlusIcon size={13} />
                  {t('vault.add')}
                </button>
              </div>
              {list.length === 0 ? (
                <button
                  onClick={() => setEditing(kind)}
                  className="w-full rounded-[22px] border border-dashed border-line-strong px-4 py-5 text-[14px] text-text-muted"
                >
                  {t('vault.empty')} +
                </button>
              ) : (
                <ul className="space-y-3">
                  {list.map((item) => (
                    <VaultCard
                      key={item.id}
                      item={item}
                      urls={urls}
                      mine={item.user_id === user?.id}
                      ownerName={people.find((p) => p.user_id === item.user_id)?.display_name ?? ''}
                      onEdit={() => setEditing(item)}
                      onView={(index) => setViewer({ urls: item.files.map((f) => urls[f]).filter(Boolean), index })}
                    />
                  ))}
                </ul>
              )}
            </section>
          )
        })}

        {hosts.length > 0 && (
          <section>
            <h2 className="text-[1.25rem] font-extrabold">🔑 {t('host.vaultTitle')}</h2>
            <p className="mb-3 text-[13px] text-text-muted">{t('host.vaultHint')}</p>
            <div className="space-y-4">
              {hosts.map((h) => (
                <div key={h.stopId}>
                  <p className="mb-1.5 text-[13px] font-bold text-text-soft">
                    {h.stop} <span className="num font-medium text-text-muted">{h.dates}</span>
                  </p>
                  <HostCards
                    hosts={h.hosts}
                    compact
                    onSave={async (next) => {
                      await updateStop(h.stopId, { hosts: next })
                      const list = hosts.map((x) => (x.stopId === h.stopId ? { ...x, hosts: next } : x))
                      setHosts(list)
                      saveVaultLocal('hosts', list)
                    }}
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {tripDocs.length > 0 && (
          <section>
            <h2 className="text-[1.25rem] font-extrabold">{t('vault.trip')}</h2>
            <p className="mb-3 text-[13px] text-text-muted">{t('vault.tripHint')}</p>
            <ul className="overflow-hidden rounded-[22px] border border-line bg-surface">
              {tripDocs.map((d) => (
                <li key={d.id}>
                  <button
                    onClick={async () => {
                      const w = window.open('', '_blank')
                      const url = (await cachedUrl(d.id)) ?? (await openDocumentUrl(d).catch(() => null))
                      if (url && w) w.location.href = url
                      else w?.close()
                    }}
                    className="flex w-full items-center gap-3 border-b border-line px-4 py-3.5 text-left last:border-b-0"
                  >
                    <span className="text-xl">{d.kind === 'flight' ? '✈️' : d.kind === 'stay' ? '🏨' : d.kind === 'insurance' ? '🛟' : '🚆'}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold">{d.title}</span>
                      {d.reference && <span className="num block font-mono text-[12px] text-text-muted">{d.reference}</span>}
                    </span>
                    <span className="text-text-muted">›</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {editing && user && (
        <VaultForm
          kind={typeof editing === 'string' ? editing : editing.kind}
          item={typeof editing === 'string' ? undefined : editing}
          userId={user.id}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await reload()
          }}
        />
      )}
      {viewer && <Viewer urls={viewer.urls} index={viewer.index} onClose={() => setViewer(null)} />}
    </div>
  )
}

function VaultCard({
  item,
  urls,
  mine,
  ownerName,
  onEdit,
  onView,
}: {
  item: VaultItem
  urls: Record<string, string>
  mine: boolean
  ownerName: string
  onEdit: () => void
  onView: (index: number) => void
}) {
  const { t, locale } = useI18n()
  const [show, setShow] = useState(false)
  const [copied, setCopied] = useState(false)
  const today = todayIso()
  const expired = item.expires && item.expires < today
  const soon = !expired && item.expires && item.expires < addDaysIso(today, 200)
  const masked = item.number ? (show ? item.number : `•••• ${item.number.slice(-4)}`) : null

  return (
    <li className="rounded-[22px] border border-line bg-surface p-4 shadow-[var(--shadow-sm)]">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-bold">{item.title}</p>
          <p className="text-[13px] text-text-muted">
            {[item.holder, !mine && t('vault.sharedBy', { name: ownerName || '…' })].filter(Boolean).join(' · ')}
            {item.shared && mine && ' · 👫'}
          </p>
        </div>
        {expired && <span className="chip chip-bad">{t('vault.expired')}</span>}
        {soon && <span className="chip chip-warn">{t('vault.expiresSoon')}</span>}
        {/* Coffre commun : on modifie aussi ce que l'autre a partage */}
        <EditButton onClick={onEdit} label={t('vault.edit')} />
      </div>

      {masked && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
          <span className="num min-w-0 flex-1 truncate font-mono text-[15px] tracking-wider">{masked}</span>
          {item.number && item.number.length > 4 && (
            <button onClick={() => setShow((v) => !v)} className="text-[12px] font-semibold text-text-muted">
              {show ? t('vault.hide') : t('vault.show')}
            </button>
          )}
          <button
            onClick={async () => {
              await navigator.clipboard?.writeText(item.number ?? '')
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1500)
            }}
            className="text-[12px] font-semibold text-accent"
          >
            {copied ? t('vault.copied') : t('vault.copy')}
          </button>
        </div>
      )}

      {item.expires && (
        <p className="mt-2 text-[13px] text-text-muted">
          {t('vault.f.expires')} <span className="num font-semibold text-text-soft">{shortDate(item.expires, locale)}</span>
        </p>
      )}

      {(item.phone || item.email || item.url) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {item.phone && (
            <a href={`tel:${item.phone.replace(/\s/g, '')}`} className="btn btn-xs btn-accent">
              📞 {t('vault.call')} <span className="num font-normal opacity-90">{item.phone}</span>
            </a>
          )}
          {item.email && (
            <a href={`mailto:${item.email}`} className="btn btn-xs">
              ✉️ {t('vault.mail')}
            </a>
          )}
          {item.url && (
            <a href={item.url} target="_blank" rel="noreferrer" className="btn btn-xs">
              🔗
            </a>
          )}
        </div>
      )}

      {item.files.length > 0 && (
        <div className="nav-scroll mt-3 flex gap-2 overflow-x-auto">
          {item.files.map((f, i) =>
            urls[f] ? (
              /\.pdf$/i.test(f) ? (
                <a key={f} href={urls[f]} target="_blank" rel="noreferrer" className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-2 text-2xl">
                  📄
                </a>
              ) : (
                <button key={f} onClick={() => onView(i)} className="h-20 w-28 shrink-0 overflow-hidden rounded-xl border border-line bg-white">
                  <img src={urls[f]} alt="" className="h-full w-full object-cover" />
                </button>
              )
            ) : null,
          )}
        </div>
      )}

      {item.notes && <p className="mt-3 whitespace-pre-wrap text-[14px] text-text-soft">{item.notes}</p>}
    </li>
  )
}

/** Photo ou QR en plein ecran, sur fond blanc, pour le scan a l'aeroport. */
function Viewer({ urls, index, onClose }: { urls: string[]; index: number; onClose: () => void }) {
  const { t } = useI18n()
  const [i, setI] = useState(index)
  return <Lightbox urls={urls} index={i} onIndexChange={setI} onClose={onClose} caption={`💡 ${t('vault.qrHint')}`} light />
}

function VaultForm({
  kind: initialKind,
  item,
  userId,
  onClose,
  onSaved,
}: {
  kind: VaultKind
  item?: VaultItem
  userId: string
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [kind, setKind] = useState<VaultKind>(initialKind)
  const [form, setForm] = useState<VaultInput>({
    kind: initialKind,
    title: item?.title ?? '',
    holder: item?.holder ?? '',
    number: item?.number ?? '',
    expires: item?.expires ?? null,
    phone: item?.phone ?? '',
    email: item?.email ?? '',
    url: item?.url ?? '',
    notes: item?.notes ?? '',
    shared: item?.shared ?? true,
  })
  const [files, setFiles] = useState<File[]>([])
  const [removed, setRemoved] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const set = <K extends keyof VaultInput>(k: K, v: VaultInput[K]) => setForm((f) => ({ ...f, [k]: v }))

  async function save() {
    if (!form.title.trim()) return
    setBusy(true)
    setError(null)
    try {
      const clean: VaultInput = {
        ...form,
        kind,
        title: form.title.trim(),
        holder: form.holder?.trim() || null,
        number: form.number?.replace(/\s+/g, ' ').trim() || null,
        phone: form.phone?.trim() || null,
        email: form.email?.trim() || null,
        url: form.url?.trim() || null,
        notes: form.notes?.trim() || null,
      }
      await saveVaultItem(userId, clean, files, item, removed)
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  const showNumber = kind !== 'contact'
  const showExpiry = kind === 'identity' || kind === 'card' || kind === 'insurance' || kind === 'other'
  const showContact = kind === 'contact' || kind === 'card' || kind === 'insurance' || kind === 'ticket'

  return (
    <Portal><div className="fixed inset-0 z-[1300] flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        className="panel-enter max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-[30px] bg-bg p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-[var(--shadow-lg)] sm:rounded-[30px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line-strong sm:hidden" />
        <div className="flex items-center justify-between">
          <h2 className="text-[1.4rem] font-extrabold">{item ? t('vault.edit') : t('vault.new')}</h2>
          <button onClick={onClose} className="btn btn-quiet btn-xs">{t('common.close')}</button>
        </div>

        <div className="nav-scroll -mx-1 mt-4 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {KINDS.map((k) => (
            <button key={k} onClick={() => setKind(k)} className={`pill shrink-0 ${kind === k ? 'pill-active' : ''}`}>
              {t(`vault.kind.${k}` as Key)}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          <Field label={t('vault.f.title')} value={form.title} onChange={(v) => set('title', v)} placeholder={t(`vault.f.ph.${kind}` as Key)} autoFocus />
          <Field label={t('vault.f.holder')} value={form.holder ?? ''} onChange={(v) => set('holder', v)} />
          {showNumber && (
            <Field
              label={kind === 'card' ? t('vault.f.numberCard') : t('vault.f.number')}
              value={form.number ?? ''}
              onChange={(v) => set('number', kind === 'card' ? v.replace(/\D/g, '').slice(-4) : v)}
              inputMode={kind === 'card' ? 'numeric' : undefined}
              mono
            />
          )}
          {kind === 'card' && <p className="text-[12px] leading-snug text-text-muted">🔒 {t('vault.f.cardHint')}</p>}
          {showExpiry && (
            <div>
              <label className="label">{t('vault.f.expires')}</label>
              <input type="date" className="field num" value={form.expires ?? ''} onChange={(e) => set('expires', e.target.value || null)} />
            </div>
          )}
          {showContact && (
            <>
              <Field label={t('vault.f.phone')} value={form.phone ?? ''} onChange={(v) => set('phone', v)} inputMode="tel" />
              <Field label={t('vault.f.email')} value={form.email ?? ''} onChange={(v) => set('email', v)} inputMode="email" />
            </>
          )}
          <div>
            <label className="label">{t('vault.f.notes')}</label>
            <textarea className="field min-h-20 resize-y" value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
          </div>

          <div>
            <label className="label">{t('vault.f.files')}</label>
            <div className="flex flex-wrap gap-2">
              {(item?.files ?? []).filter((f) => !removed.includes(f)).map((f) => (
                <button key={f} onClick={() => setRemoved((r) => [...r, f])} className="chip">
                  📎 {f.split('/').pop()?.slice(0, 8)} ✕
                </button>
              ))}
              {files.map((f, i) => (
                <button key={i} onClick={() => setFiles((list) => list.filter((_, k) => k !== i))} className="chip chip-accent">
                  📎 {f.name.slice(0, 16)} ✕
                </button>
              ))}
              <button onClick={() => input.current?.click()} className="btn btn-xs">
                📷 +
              </button>
            </div>
            <input
              ref={input}
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="hidden"
              onChange={(e) => setFiles((list) => [...list, ...Array.from(e.target.files ?? [])])}
            />
          </div>

          <label className="flex items-center gap-2.5 rounded-2xl border border-line bg-surface px-3.5 py-3 text-[14px]">
            <input type="checkbox" checked={form.shared} onChange={(e) => set('shared', e.target.checked)} />
            👫 {t('vault.f.shared')}
          </label>
        </div>

        {error && <p className="notice notice-bad mt-4">{error}</p>}

        <div className="mt-5 flex gap-2">
          <button onClick={() => void save()} disabled={busy || !form.title.trim()} className="btn btn-accent flex-1">
            {busy ? t('common.saving') : t('common.save')}
          </button>
          {item && (
            <button
              onClick={async () => {
                if (!confirmDel) return setConfirmDel(true)
                await deleteVaultItem(item)
                onSaved()
              }}
              className={`btn ${confirmDel ? 'border-red-500/60 text-red-500' : 'btn-quiet'}`}
            >
              {confirmDel ? t('vault.deleteConfirm') : t('vault.delete')}
            </button>
          )}
        </div>
      </div>
    </div></Portal>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
  mono,
  autoFocus,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  inputMode?: 'numeric' | 'tel' | 'email'
  mono?: boolean
  autoFocus?: boolean
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        className={`field ${mono ? 'num font-mono tracking-wider' : ''}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        autoFocus={autoFocus}
        autoComplete="off"
      />
    </div>
  )
}
