import { useEffect, useState } from 'react'
import { checkPin, loadPin, setPin } from '../../lib/vault'
import { useI18n } from '../../i18n/I18nContext'
import type { Key } from '../../i18n/fr'

/** Le coffre reste ouvert 3 minutes sans activite, puis se reverrouille. */
const OPEN_MS = 3 * 60 * 1000
let unlockedUntil = 0

export function touchVault() {
  if (unlockedUntil > Date.now()) unlockedUntil = Date.now() + OPEN_MS
}
export function lockVault() {
  unlockedUntil = 0
}

type Step = 'old' | 'new' | 'confirm' | 'unlock'

/**
 * Clavier a code facon iPhone : 5 points, grosses touches, on tape et ca
 * avance seul.
 *  - Premiere fois : Nouveau code -> Confirmer.
 *  - Changement (reglages) : Ancien code -> Nouveau code -> Confirmer.
 *  - Sinon : le code ouvre le coffre.
 * Les etapes s'affichent en haut, l'ecran glisse d'une etape a l'autre.
 */
export default function PinGate({
  children,
  change = false,
  onChanged,
}: {
  children: React.ReactNode
  change?: boolean
  onChanged?: () => void
}) {
  const { t } = useI18n()
  const [record, setRecord] = useState<{ salt: string; hash: string } | null | undefined>(undefined)
  const [open, setOpen] = useState(() => unlockedUntil > Date.now() && !change)
  const [step, setStep] = useState<Step>('unlock')
  const [code, setCode] = useState('')
  const [fresh, setFresh] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [shake, setShake] = useState(false)
  const [fails, setFails] = useState(0)
  const [waitUntil, setWaitUntil] = useState(0)
  const [success, setSuccess] = useState(false)
  const [, tick] = useState(0)

  useEffect(() => {
    void loadPin().then((r) => {
      setRecord(r)
      setStep(r === null ? 'new' : change ? 'old' : 'unlock')
    })
  }, [change])

  // Reverrouillage : inactivite, ou quand l'app passe en arriere-plan
  useEffect(() => {
    if (!open) return
    const onActivity = () => touchVault()
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        lockVault()
        setOpen(false)
        setStep('unlock')
      }
    }
    const timer = window.setInterval(() => {
      if (unlockedUntil < Date.now()) {
        setOpen(false)
        setStep('unlock')
      }
    }, 5000)
    window.addEventListener('pointerdown', onActivity)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('pointerdown', onActivity)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [open])

  useEffect(() => {
    if (waitUntil <= Date.now()) return
    const timer = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(timer)
  }, [waitUntil])

  const waiting = waitUntil > Date.now()
  const flow: Step[] = record === null ? ['new', 'confirm'] : change ? ['old', 'new', 'confirm'] : []

  function wrong(message: string, countFail = true) {
    setError(message)
    setShake(true)
    setCode('')
    window.setTimeout(() => setShake(false), 450)
    if (countFail) {
      const n = fails + 1
      setFails(n)
      if (n >= 5) {
        setWaitUntil(Date.now() + 30_000)
        setFails(0)
      }
    }
  }

  async function submit(value: string) {
    if (step === 'unlock' || step === 'old') {
      if (record && (await checkPin(value, record))) {
        setFails(0)
        setCode('')
        if (step === 'old') return setStep('new')
        unlockedUntil = Date.now() + OPEN_MS
        return setOpen(true)
      }
      return wrong(t('vault.pin.wrong'))
    }
    if (step === 'new') {
      setFresh(value)
      setCode('')
      return setStep('confirm')
    }
    // confirm
    if (value !== fresh) {
      setFresh(null)
      setStep('new')
      return wrong(t('vault.pin.mismatch'), false)
    }
    await setPin(value)
    setRecord(await loadPin())
    setSuccess(true)
    window.setTimeout(() => {
      unlockedUntil = Date.now() + OPEN_MS
      setSuccess(false)
      setOpen(true)
      onChanged?.()
    }, 900)
  }

  function press(d: string) {
    if (waiting || success) return
    setError(null)
    const next = (code + d).slice(0, 5)
    setCode(next)
    if (next.length === 5) window.setTimeout(() => void submit(next), 140)
  }

  if (open && !change) return <>{children}</>
  if (open && change && !success) return <>{children}</>
  if (record === undefined) return null

  const titles: Record<Step, Key> = {
    unlock: 'vault.pin.enter',
    old: 'vault.pin.old',
    new: record === null ? 'vault.pin.create' : 'vault.pin.new',
    confirm: 'vault.pin.confirm',
  }

  return (
    <div className="mx-auto flex max-w-xs flex-col items-center px-5 py-10">
      {/* Etapes */}
      {flow.length > 0 && (
        <div className="mb-6 flex w-full items-center justify-center gap-2">
          {flow.map((s, i) => {
            const idx = flow.indexOf(step)
            const done = i < idx || success
            const active = i === idx && !success
            return (
              <div key={s} className="flex items-center gap-2">
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-extrabold transition-all duration-300 ${
                    done ? 'bg-[var(--color-olive)] text-white' : active ? 'scale-110 bg-accent text-accent-ink' : 'bg-surface-2 text-text-muted'
                  }`}
                >
                  {done ? '✓' : i + 1}
                </span>
                {i < flow.length - 1 && <span className={`h-0.5 w-6 rounded-full ${i < idx ? 'bg-[var(--color-olive)]' : 'bg-line-strong'}`} />}
              </div>
            )
          })}
        </div>
      )}

      <div className={`flex h-16 w-16 items-center justify-center rounded-full text-3xl transition-all duration-300 ${success ? 'bg-[rgba(124,135,103,0.2)]' : 'bg-[var(--halo)]'}`}>
        {success ? '✅' : '🔐'}
      </div>

      <div key={step + String(success)} className="fade-in flex w-full flex-col items-center">
        <h2 className="mt-5 text-center text-[1.35rem] font-extrabold">{success ? t('vault.pin.done') : t(titles[step])}</h2>
        {step === 'new' && record === null && !success && (
          <p className="mt-1 text-center text-[13px] text-text-muted">{t('vault.pin.firstHint')}</p>
        )}

        <div className={`mt-6 flex gap-3.5 ${shake ? 'animate-[shake_0.45s]' : ''}`}>
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className={`h-3.5 w-3.5 rounded-full border-2 transition-all duration-150 ${
                success || i < code.length ? 'scale-110 border-accent bg-accent' : 'border-line-strong'
              }`}
            />
          ))}
        </div>
        <p className="mt-3 h-5 text-center text-[13px] font-semibold text-[#b4533f]">
          {waiting ? t('vault.pin.wait', { s: Math.ceil((waitUntil - Date.now()) / 1000) }) : error}
        </p>
      </div>

      <div className="mt-4 grid w-full grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) =>
          k === '' ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              onClick={() => (k === '⌫' ? setCode((c) => c.slice(0, -1)) : press(k))}
              disabled={waiting || success}
              aria-label={k === '⌫' ? 'effacer' : k}
              className="aspect-square rounded-full border border-line bg-surface text-[1.6rem] font-bold shadow-[var(--shadow-sm)] active:bg-[var(--halo)]"
            >
              {k}
            </button>
          ),
        )}
      </div>
    </div>
  )
}
