import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../i18n/I18nContext'

const SEEN = 'bubutravel:greeted'

/** « Bonjour » de 5 h a 18 h, « Bonsoir » ensuite. */
export function greetingKey(date = new Date()) {
  const h = date.getHours()
  return h >= 5 && h < 18 ? 'greet.morning' : 'greet.evening'
}

/**
 * Accueil a l'ouverture de l'app : la photo ronde et « Bonjour, Diego ».
 * Une fois par ouverture (pas a chaque page), disparait seul ou au toucher.
 * `preview` force l'affichage depuis le profil.
 */
export default function Greeting({ preview, onEnd }: { preview?: 'big' | 'small'; onEnd?: () => void }) {
  const { user, profile } = useAuth()
  const { t, locale } = useI18n()
  const [phase, setPhase] = useState<'hidden' | 'in' | 'out'>('hidden')
  const style = preview ?? profile?.greeting ?? 'big'

  useEffect(() => {
    if (preview) {
      setPhase('in')
      return
    }
    if (!user || !profile || style === 'off') return
    try {
      if (sessionStorage.getItem(SEEN)) return
      sessionStorage.setItem(SEEN, '1')
    } catch {
      // sans stockage de session : on salue quand meme
    }
    setPhase('in')
  }, [user, profile, style, preview])

  useEffect(() => {
    if (phase !== 'in') return
    const timer = window.setTimeout(() => setPhase('out'), preview ? 2600 : 2100)
    return () => window.clearTimeout(timer)
  }, [phase, preview])

  useEffect(() => {
    if (phase !== 'out') return
    const timer = window.setTimeout(() => {
      setPhase('hidden')
      onEnd?.()
    }, 650)
    return () => window.clearTimeout(timer)
  }, [phase, onEnd])

  if (phase === 'hidden' || !profile) return null
  const name = profile.display_name || user?.email?.split('@')[0] || ''
  const big = style === 'big'
  const size = big ? 168 : 84
  const today = new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })

  return createPortal(
    <div
      onClick={() => setPhase('out')}
      className="fixed inset-0 z-[4000] flex flex-col items-center justify-center px-8 text-center"
      style={{
        background:
          'radial-gradient(120% 90% at 15% 10%, #ffb38a 0%, transparent 55%), radial-gradient(110% 90% at 90% 20%, #ffd36e 0%, transparent 50%), radial-gradient(120% 100% at 80% 100%, #8fd8d2 0%, transparent 55%), radial-gradient(100% 90% at 0% 100%, #d9a3e6 0%, transparent 55%), #f6c7a8',
        opacity: phase === 'out' ? 0 : 1,
        transform: phase === 'out' ? 'scale(1.04)' : 'scale(1)',
        transition: 'opacity .6s cubic-bezier(.22,1,.36,1), transform .6s cubic-bezier(.22,1,.36,1)',
      }}
    >
      <div className="greet-pop" style={{ width: size, height: size }}>
        {profile.avatar_url ? (
          <img
            src={profile.avatar_url}
            alt=""
            className="h-full w-full rounded-full object-cover"
            style={{ boxShadow: '0 0 0 5px rgba(255,255,255,.85), 0 18px 50px rgba(120,50,20,.35)' }}
          />
        ) : (
          <span
            className="flex h-full w-full items-center justify-center rounded-full bg-white/70 font-extrabold text-[#5a2a14]"
            style={{ fontSize: size * 0.4, boxShadow: '0 18px 50px rgba(120,50,20,.3)' }}
          >
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
      </div>
      <h1
        className="greet-rise mt-7 font-extrabold leading-tight text-[#3b1a0c]"
        style={{ fontSize: big ? 'clamp(2.2rem, 9vw, 3.4rem)' : 'clamp(1.8rem, 7vw, 2.6rem)' }}
      >
        {t(greetingKey() as 'greet.morning')}, {name}
      </h1>
      <p className="greet-rise-2 mt-2 text-[15px] font-semibold capitalize text-[#5a2a14]/75">{today}</p>
    </div>,
    document.body,
  )
}
