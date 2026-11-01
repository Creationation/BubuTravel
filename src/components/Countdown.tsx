import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/I18nContext'

/**
 * Compte a rebours avant le depart : jours, heures, minutes, secondes, qui
 * defilent en direct. Pendant le voyage : « Jour X sur Y ». Apres : rien.
 * Le depart est compte a minuit (heure du telephone) le jour du debut.
 */
export default function Countdown({
  start,
  end,
  size = 'lg',
  light = false,
}: {
  start: string | null
  end: string | null
  size?: 'lg' | 'sm'
  light?: boolean
}) {
  const { t } = useI18n()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  if (!start) return null
  const startMs = new Date(`${start}T00:00:00`).getTime()
  const endMs = end ? new Date(`${end}T23:59:59`).getTime() : startMs
  const ink = light ? 'text-[#fbf3e8]' : 'text-text'
  const muted = light ? 'text-[#fbf3e8]/75' : 'text-text-muted'

  if (now >= startMs) {
    if (now > endMs) return null
    const day = Math.floor((now - startMs) / 86_400_000) + 1
    const total = Math.round((endMs - startMs) / 86_400_000)
    return (
      <p className={`font-extrabold ${size === 'lg' ? 'text-3xl' : 'text-lg'} ${ink}`}>
        {t('hub.countdown.during', { day, total })}
      </p>
    )
  }

  let rest = Math.floor((startMs - now) / 1000)
  const days = Math.floor(rest / 86400)
  rest -= days * 86400
  const hours = Math.floor(rest / 3600)
  rest -= hours * 3600
  const minutes = Math.floor(rest / 60)
  const seconds = rest - minutes * 60

  const units: [number, string][] = [
    [days, t('cd.days')],
    [hours, t('cd.hours')],
    [minutes, t('cd.minutes')],
    [seconds, t('cd.seconds')],
  ]

  return (
    <div>
      <p className={`mb-2 text-[11px] font-bold uppercase tracking-[0.16em] ${muted}`}>{t('cd.before')}</p>
      <div className="flex gap-2">
        {units.map(([value, label], i) => (
          <div
            key={label}
            className={`flex flex-col items-center rounded-2xl border backdrop-blur-md ${
              light ? 'border-white/25 bg-white/15' : 'border-line bg-surface'
            } ${size === 'lg' ? 'min-w-[4.6rem] px-3 py-2.5' : 'min-w-[3.3rem] px-2 py-1.5'}`}
          >
            <span
              className={`num font-extrabold leading-none ${size === 'lg' ? 'text-[2rem]' : 'text-xl'} ${
                i === 0 ? (light ? 'text-[#ffc59e]' : 'text-accent') : ink
              }`}
            >
              {i === 0 ? value : String(value).padStart(2, '0')}
            </span>
            <span className={`mt-1 text-[10px] font-semibold uppercase tracking-wider ${muted}`}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
