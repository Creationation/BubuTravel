import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Portal from '../components/Portal'
import { useI18n } from '../i18n/I18nContext'

export type ConfirmOptions = {
  title: string
  /** Nom de ce qui va etre supprime, affiche en evidence */
  subject?: string
  message?: string
  confirmLabel?: string
  /** true par defaut : bouton rouge pour une suppression */
  danger?: boolean
  icon?: string
}
export type ToastOptions = {
  icon?: string
  /** Action proposee dans le toast (ex. Annuler) */
  action?: { label: string; run: () => void | Promise<unknown> }
  tone?: 'ok' | 'bad'
}

type Feedback = {
  confirm: (o: ConfirmOptions) => Promise<boolean>
  toast: (message: string, o?: ToastOptions) => void
  /** Confirme, execute, puis affiche un toast de reussite (ou d'erreur) */
  confirmDelete: (o: ConfirmOptions & { done: string; run: () => Promise<unknown>; undo?: () => Promise<unknown> }) => Promise<boolean>
}

const Ctx = createContext<Feedback | null>(null)

export function useFeedback(): Feedback {
  const v = useContext(Ctx)
  if (!v) throw new Error('useFeedback hors FeedbackProvider')
  return v
}

type ToastItem = ToastOptions & { id: number; message: string }

/** Dialogue de confirmation propre + toasts, partages par toute l'app. */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const [ask, setAsk] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const seq = useRef(0)

  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setAsk({ ...o, resolve })), [])

  const toast = useCallback((message: string, o: ToastOptions = {}) => {
    const id = ++seq.current
    setToasts((l) => [...l.slice(-2), { ...o, id, message }])
    window.setTimeout(() => setToasts((l) => l.filter((x) => x.id !== id)), o.action ? 6500 : 3200)
  }, [])

  const confirmDelete = useCallback<Feedback['confirmDelete']>(
    async ({ done, run, undo, ...o }) => {
      if (!(await confirm(o))) return false
      try {
        await run()
        toast(done, { icon: '🗑️', action: undo ? { label: t('fb.undo'), run: undo } : undefined })
        return true
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), { icon: '⚠️', tone: 'bad' })
        return false
      }
    },
    [confirm, toast, t],
  )

  const value = useMemo(() => ({ confirm, toast, confirmDelete }), [confirm, toast, confirmDelete])

  function answer(ok: boolean) {
    ask?.resolve(ok)
    setAsk(null)
  }

  useEffect(() => {
    if (!ask) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        ask.resolve(false)
        setAsk(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ask])

  const danger = ask?.danger !== false

  return (
    <Ctx.Provider value={value}>
      {children}
      {ask && (
        <Portal>
          <div className="fixed inset-0 z-[3000] flex items-end justify-center p-4 sm:items-center" role="alertdialog" aria-modal="true">
            <div className="absolute inset-0 bg-[#120d09]/65" onClick={() => answer(false)} />
            <div className="sheet-in relative w-full max-w-sm rounded-[28px] bg-surface-solid p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-center shadow-[var(--shadow-lg)] sm:pb-6">
              <p className="text-4xl">{ask.icon ?? (danger ? '🗑️' : '❔')}</p>
              <p className="mt-2 text-[1.2rem] font-extrabold leading-tight">{ask.title}</p>
              {ask.subject && <p className="mx-auto mt-2 max-w-full break-words rounded-xl bg-surface-2 px-3 py-2 text-[14px] font-bold">{ask.subject}</p>}
              <p className="mt-2 text-[13.5px] leading-snug text-text-muted">{ask.message ?? (danger ? t('fb.irreversible') : '')}</p>
              <div className="mt-5 grid grid-cols-2 gap-2.5">
                <button onClick={() => answer(false)} className="btn" autoFocus>
                  {t('common.cancel')}
                </button>
                <button onClick={() => answer(true)} className={`btn ${danger ? '!bg-[#b4533f] !text-white' : 'btn-accent'}`}>
                  {ask.confirmLabel ?? (danger ? t('act.delete') : t('common.confirm'))}
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
      <Portal>
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[3100] flex flex-col items-center gap-2 px-4">
          {toasts.map((x) => (
            <div
              key={x.id}
              role="status"
              className={`fade-in pointer-events-auto flex max-w-sm items-center gap-3 rounded-2xl px-4 py-3 text-[14px] font-semibold shadow-[var(--shadow-lg)] ${x.tone === 'bad' ? 'bg-[#b4533f] text-white' : 'bg-[#241b15] text-[#fff6ec]'}`}
            >
              <span>{x.icon ?? '✅'}</span>
              <span className="min-w-0 flex-1">{x.message}</span>
              {x.action && (
                <button
                  onClick={() => {
                    setToasts((l) => l.filter((y) => y.id !== x.id))
                    void x.action?.run()
                  }}
                  className="shrink-0 rounded-lg px-2 py-1 font-extrabold text-[#ffb98f]"
                >
                  {x.action.label}
                </button>
              )}
            </div>
          ))}
        </div>
      </Portal>
    </Ctx.Provider>
  )
}
