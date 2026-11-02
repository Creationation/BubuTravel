import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlaces } from '../context/PlacesContext'
import { deleteDraft, fetchDrafts, onDraftsChange, setDraftReminder } from '../lib/drafts'
import type { DraftRow } from '../lib/drafts'
import { createTodo } from '../lib/tripApi'
import { addDaysIso, todayIso } from '../lib/tripDates'
import { useI18n } from '../i18n/I18nContext'
import type { Key } from '../i18n/fr'
import { BellIcon, FileIcon } from './hub/icons'
import Portal from './Portal'

/**
 * Le tiroir des brouillons : tout ce qui a ete commence et pas termine.
 * Le bouton de l'en-tete affiche leur nombre et s'allume quand un rappel
 * est arrive a echeance.
 */
export default function DraftsButton() {
  const { t, locale } = useI18n()
  const navigate = useNavigate()
  const { trips } = usePlaces()
  const [drafts, setDrafts] = useState<DraftRow[]>([])
  const [open, setOpen] = useState(false)

  const reload = useCallback(async () => {
    try {
      setDrafts(await fetchDrafts())
    } catch {
      // Table absente ou hors ligne : le bouton reste simplement vide
    }
  }, [])

  useEffect(() => {
    void reload()
    const off = onDraftsChange(() => void reload())
    window.addEventListener('focus', reload)
    return () => {
      off()
      window.removeEventListener('focus', reload)
    }
  }, [reload])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const now = Date.now()
  const due = drafts.filter((d) => d.remind_at && new Date(d.remind_at).getTime() <= now).length

  if (drafts.length === 0) return null

  async function remindTomorrow(d: DraftRow) {
    const tomorrow = addDaysIso(todayIso(), 1)
    await setDraftReminder(d.key, `${tomorrow}T09:00:00`)
    // Dans un voyage, le rappel devient aussi un « a faire » : il part dans
    // l'agenda du telephone avec les autres.
    if (d.trip_id) {
      await createTodo({
        trip_id: d.trip_id,
        title: `${t('drafts.resume')} : ${d.title ?? t(`drafts.kind.${d.kind}` as Key)}`,
        kind: 'todo',
        due_at: `${tomorrow}T09:00:00`,
        has_time: true,
        remind_minutes: 0,
      }).catch(() => undefined)
    }
    await reload()
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`btn btn-xs ${due > 0 ? 'btn-accent' : 'btn-quiet'}`}
        title={t('drafts.banner', { n: drafts.length })}
      >
        <FileIcon size={14} />
        <span className="hidden sm:inline">{t('drafts.open')}</span>
        <span className="num">{drafts.length}</span>
      </button>

      {open && (
        <Portal><div className="fixed inset-0 z-[1300] flex justify-end bg-[#120d09]/45 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <aside
            className="panel-enter flex h-full w-full max-w-md flex-col border-l border-line bg-bg shadow-[var(--shadow-lg)]"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-line px-6 py-5">
              <div>
                <p className="eyebrow eyebrow-dot">{t('drafts.title')}</p>
                <p className="mt-1 text-[13px] text-text-muted">{t('drafts.banner', { n: drafts.length })}</p>
              </div>
              <button onClick={() => setOpen(false)} className="btn btn-quiet btn-xs">
                {t('common.close')}
              </button>
            </header>

            <ul className="flex-1 space-y-3 overflow-y-auto p-5">
              {drafts.map((d) => {
                const trip = trips.find((x) => x.id === d.trip_id)
                const isDue = d.remind_at && new Date(d.remind_at).getTime() <= now
                const preview = previewOf(d.payload)
                return (
                  <li key={d.id} className={`card p-4 ${isDue ? 'border-accent/60' : ''}`}>
                    <div className="flex items-center gap-2">
                      <span className="chip">{t(`drafts.kind.${d.kind}` as Key)}</span>
                      {isDue && <span className="chip chip-accent">{t('drafts.due')}</span>}
                      <span className="num ml-auto text-[11px] text-text-muted">
                        {new Date(d.updated_at).toLocaleString(locale, {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    {trip && <p className="mt-3 text-[13px] font-semibold">{trip.title}</p>}
                    {preview && <p className="mt-1 line-clamp-3 text-[13px] text-text-soft">{preview}</p>}
                    <div className="mt-4 flex flex-wrap items-center gap-1.5">
                      <button
                        onClick={() => {
                          setOpen(false)
                          const url = d.resume_url ?? '/'
                          navigate(d.kind === 'assistant' ? `${url.split('?')[0]}?assistant=1` : url)
                        }}
                        className="btn btn-accent btn-xs"
                      >
                        {t('drafts.resume')}
                      </button>
                      {!d.remind_at && (
                        <button onClick={() => void remindTomorrow(d)} className="btn btn-quiet btn-xs">
                          <BellIcon size={12} />
                          {t('drafts.remind')}
                        </button>
                      )}
                      {d.remind_at && !isDue && <span className="chip">{t('drafts.reminded')}</span>}
                      <button onClick={() => void deleteDraft(d.key).then(reload)} className="btn btn-quiet btn-xs ml-auto">
                        {t('drafts.delete')}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </aside>
        </div></Portal>
      )}
    </>
  )
}

/** Premier texte parlant du brouillon, pour savoir de quoi il s'agit. */
function previewOf(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const values = Object.values(payload as Record<string, unknown>)
  const text = values.find((v): v is string => typeof v === 'string' && v.trim().length > 0)
  return text ? text.trim().slice(0, 220) : ''
}
