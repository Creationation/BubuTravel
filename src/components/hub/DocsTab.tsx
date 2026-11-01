import { useEffect, useRef, useState } from 'react'
import { errorMessage } from '../../lib/errors'
import { forgetOffline, keepOffline, offlineIds, openDocumentUrl } from '../../lib/tripApi'
import { addDaysIso, shortDate, todayIso } from '../../lib/tripDates'
import type { DocKind, TripDocument } from '../../lib/types'
import type { TripHub } from '../../lib/useTripHub'
import { useI18n } from '../../i18n/I18nContext'
import type { Key } from '../../i18n/fr'
import { CloudOffIcon, DocIcon, PlusIcon, ShieldIcon, TrashIcon } from './icons'

export const DOC_KINDS: DocKind[] = [
  'passport',
  'visa',
  'flight',
  'transport',
  'stay',
  'insurance',
  'health',
  'money',
  'other',
]
export const docKindKey = (k: DocKind): Key => `doc.kind.${k}` as Key

/**
 * Le coffre du voyage. Rangement par type, recherche instantanee, et la
 * possibilite de garder une copie sur le telephone pour l'ouvrir sans reseau.
 */
export default function DocsTab({ hub, autoAdd = false }: { hub: TripHub; autoAdd?: boolean }) {
  const { t } = useI18n()
  const [adding, setAdding] = useState(autoAdd)
  const [query, setQuery] = useState('')
  const [offline, setOffline] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void offlineIds().then(setOffline)
  }, [hub.docs])

  const q = query.trim().toLowerCase()
  const filtered = hub.docs.filter(
    (d) =>
      !q ||
      [d.title, d.holder, d.reference, d.notes, d.file_name].some((v) => v?.toLowerCase().includes(q)),
  )

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <input
          className="field max-w-sm flex-1"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('common.search')}
          type="search"
        />
        <button onClick={() => setAdding((v) => !v)} className="btn btn-accent ml-auto">
          <PlusIcon size={16} />
          {t('doc.add')}
        </button>
      </div>

      <p className="flex items-center gap-2 text-[12px] text-text-muted">
        <ShieldIcon size={14} />
        {t('doc.private')}
      </p>

      {adding && <DocForm hub={hub} onDone={() => setAdding(false)} />}
      {error && <p className="notice notice-bad">{error}</p>}

      {hub.docs.length === 0 && !adding ? (
        <div className="card-feature px-6 py-12 text-center sm:px-12">
          <span className="glyph mx-auto h-14 w-14">
            <ShieldIcon size={24} />
          </span>
          <h3 className="display mt-5 text-4xl">{t('doc.empty')}</h3>
          <p className="lede mx-auto mt-3 max-w-xl">{t('doc.emptyHint')}</p>
          <button onClick={() => setAdding(true)} className="btn btn-accent btn-lg mt-8">
            <PlusIcon size={16} />
            {t('doc.add')}
          </button>
        </div>
      ) : (
        DOC_KINDS.map((kind) => {
          const docs = filtered.filter((d) => d.kind === kind)
          if (docs.length === 0) return null
          return (
            <section key={kind}>
              <p className="eyebrow mb-3">
                {t(docKindKey(kind))}
                <span className="num normal-case tracking-normal">{docs.length}</span>
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {docs.map((doc) => (
                  <DocCard
                    key={doc.id}
                    doc={doc}
                    offline={offline.has(doc.id)}
                    onOffline={async (on) => {
                      setError(null)
                      try {
                        if (on) await keepOffline(doc)
                        else await forgetOffline(doc.id)
                        setOffline(await offlineIds())
                      } catch (err) {
                        setError(errorMessage(err))
                      }
                    }}
                    onDelete={() => hub.removeDoc(doc).catch((e) => setError(errorMessage(e)))}
                    onError={setError}
                  />
                ))}
              </div>
            </section>
          )
        })
      )}

      {hub.docs.length > 0 && <p className="text-[12px] text-text-muted">{t('doc.offlineHint')}</p>}
    </div>
  )
}

function DocCard({
  doc,
  offline,
  onOffline,
  onDelete,
  onError,
}: {
  doc: TripDocument
  offline: boolean
  onOffline: (on: boolean) => Promise<void>
  onDelete: () => void
  onError: (e: string) => void
}) {
  const { t, locale } = useI18n()
  const [confirm, setConfirm] = useState(false)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const today = todayIso()
  const expired = doc.valid_until && doc.valid_until < today
  // Un passeport doit souvent etre valable 6 mois apres le retour
  const soon = !expired && doc.valid_until && doc.valid_until < addDaysIso(today, 200)

  async function open() {
    // L'onglet s'ouvre tout de suite, sinon le navigateur du telephone bloque
    // la fenetre ouverte apres un appel reseau.
    const win = window.open('', '_blank')
    try {
      const url = await openDocumentUrl(doc)
      if (url && win) win.location.href = url
      else win?.close()
    } catch (err) {
      win?.close()
      onError(errorMessage(err))
    }
  }

  return (
    <article className="card card-hover flex flex-col p-4">
      <div className="flex items-start gap-3">
        <span className="glyph">
          <DocIcon kind={doc.kind} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-[15px] font-semibold">{doc.title}</h4>
          <p className="truncate text-[12px] text-text-muted">
            {[doc.holder, doc.doc_date && shortDate(doc.doc_date, locale)].filter(Boolean).join(' · ')}
          </p>
        </div>
        {expired && <span className="chip chip-bad">{t('doc.expired')}</span>}
        {soon && <span className="chip chip-warn">{t('doc.expiresSoon')}</span>}
      </div>

      {doc.reference && (
        <button
          onClick={async () => {
            await navigator.clipboard?.writeText(doc.reference ?? '')
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
          }}
          className="mt-3 flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2 text-left"
        >
          <span className="num truncate font-mono text-[13px] tracking-wide">{doc.reference}</span>
          <span className="text-[11px] font-semibold text-accent">{copied ? t('doc.copied') : t('doc.copy')}</span>
        </button>
      )}

      {doc.valid_until && (
        <p className="mt-2 text-[12px] text-text-muted">
          {t('doc.validUntil')} <span className="num text-text-soft">{shortDate(doc.valid_until, locale)}</span>
        </p>
      )}
      {doc.notes && <p className="mt-2 text-[13px] text-text-soft">{doc.notes}</p>}

      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-4">
        {(doc.path || offline) && (
          <button onClick={open} className="btn btn-xs">
            {t('doc.open')}
          </button>
        )}
        {doc.path && (
          <button
            onClick={async () => {
              setBusy(true)
              await onOffline(!offline)
              setBusy(false)
            }}
            disabled={busy}
            className={`btn btn-xs ${offline ? 'pill-active' : 'btn-quiet'}`}
            title={t('doc.offlineHint')}
          >
            <CloudOffIcon size={13} />
            {offline ? t('doc.offlineOn') : t('doc.offline')}
          </button>
        )}
        <button
          onClick={() => (confirm ? onDelete() : setConfirm(true))}
          className={`btn btn-xs ml-auto ${confirm ? 'border-red-500/60 text-red-500' : 'btn-quiet'}`}
        >
          {confirm ? t('doc.deleteConfirm') : <TrashIcon size={13} />}
        </button>
      </div>
    </article>
  )
}

function DocForm({ hub, onDone }: { hub: TripHub; onDone: () => void }) {
  const { t } = useI18n()
  const [kind, setKind] = useState<DocKind>('passport')
  const [title, setTitle] = useState('')
  const [holder, setHolder] = useState('')
  const [reference, setReference] = useState('')
  const [docDate, setDocDate] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    setError(null)
    try {
      await hub.addDoc(
        {
          kind,
          title: title.trim(),
          holder: holder.trim() || null,
          reference: reference.trim() || null,
          doc_date: docDate || null,
          valid_until: validUntil || null,
          notes: notes.trim() || null,
        },
        file,
      )
      onDone()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="panel space-y-5 p-5 sm:p-7">
      <h3 className="display-sm text-2xl">{t('doc.add')}</h3>
      {error && <p className="notice notice-bad">{error}</p>}

      <div className="flex flex-wrap gap-1.5">
        {DOC_KINDS.map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={`pill ${kind === k ? 'pill-active' : ''}`}>
            <DocIcon kind={k} size={13} />
            {t(docKindKey(k))}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">{t('doc.title')}</label>
          <input
            className="field"
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('doc.titlePlaceholder')}
          />
        </div>
        <div>
          <label className="label">{t('doc.holder')}</label>
          <input
            className="field"
            value={holder}
            onChange={(e) => setHolder(e.target.value)}
            placeholder={t('doc.holderPlaceholder')}
          />
        </div>
        <div>
          <label className="label">{t('doc.reference')}</label>
          <input className="field num" value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
        <div>
          <label className="label">{t('doc.date')}</label>
          <input type="date" className="field num" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
        </div>
        <div>
          <label className="label">{t('doc.validUntil')}</label>
          <input
            type="date"
            className="field num"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">{t('common.notes')}</label>
          <input className="field" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      <div>
        <label className="label">{t('doc.file')}</label>
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-line-strong bg-surface-2 px-4 py-4 text-left transition-colors hover:border-accent"
        >
          <span className="glyph h-9 w-9">
            <PlusIcon size={16} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-medium">{file ? file.name : t('doc.choose')}</span>
            <span className="block text-[12px] text-text-muted">{t('doc.fileHint')}</span>
          </span>
        </button>
        <input
          ref={input}
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>

      <div className="flex justify-end gap-2 border-t border-line pt-5">
        <button type="button" onClick={onDone} className="btn btn-quiet">
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn-accent" disabled={busy || !title.trim()}>
          {busy ? t('doc.uploading') : t('common.save')}
        </button>
      </div>
    </form>
  )
}
