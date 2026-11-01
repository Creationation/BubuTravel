import { useEffect, useState } from 'react'
import { clearErrorLog, onErrorLogChange, readErrorLog } from '../lib/errors'
import type { AppErrorEntry } from '../lib/errors'
import { useI18n } from '../i18n/I18nContext'

export default function ErrorLogPanel() {
  const { t, locale } = useI18n()
  const [entries, setEntries] = useState<AppErrorEntry[]>(readErrorLog)
  const [open, setOpen] = useState(false)

  useEffect(() => onErrorLogChange(() => setEntries(readErrorLog())), [])

  return (
    <section className="panel p-6 sm:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="display-sm text-2xl">{t('errors.logTitle')}</h2>
          <p className="lede mt-2 text-[14px]">{t('errors.logHint')}</p>
        </div>
        <span className={`chip ${entries.length ? 'chip-warn' : ''}`}>{entries.length}</span>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button onClick={() => setOpen((v) => !v)} className="btn">
          {open ? t('errors.hide') : t('errors.show')}
        </button>
        {entries.length > 0 && (
          <button
            onClick={() => {
              clearErrorLog()
              setEntries([])
            }}
            className="btn btn-quiet"
          >
            {t('errors.clear')}
          </button>
        )}
      </div>

      {open && (
        <div className="mt-5 space-y-2">
          {entries.length === 0 ? (
            <p className="notice">{t('errors.empty')}</p>
          ) : (
            entries.map((entry) => (
              <details key={entry.id} className="rounded-2xl border border-line bg-surface p-3.5">
                <summary className="cursor-pointer list-none">
                  <span className="block break-words text-[13px] font-semibold">{entry.message}</span>
                  <span className="num mt-1 block text-[11px] text-text-muted">
                    {new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(entry.at))} · {entry.source}
                  </span>
                </summary>
                {entry.details && <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[10px] text-text-muted">{entry.details}</pre>}
              </details>
            ))
          )}
        </div>
      )}
    </section>
  )
}
