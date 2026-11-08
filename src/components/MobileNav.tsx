import { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useMode } from '../context/ModeContext'
import { usePlaces } from '../context/PlacesContext'
import { useTheme } from '../context/ThemeContext'
import { pickCurrentTrip } from '../lib/currentTrip'
import { useI18n } from '../i18n/I18nContext'
import type { Key } from '../i18n/fr'
import {
  CalendarIcon,
  FileIcon,
  LinkIcon,
  ListIcon,
  PinIcon,
  PlusIcon,
  RouteIcon,
  ShieldIcon,
  SparkIcon,
  WalletIcon,
} from './hub/icons'
import { LogoutIcon } from './hub/icons'

/**
 * Navigation du telephone : une barre en bas, a portee de pouce, avec cinq
 * entrees. Le « + » central ouvre les ajouts rapides, « Plus » le reste.
 */
export default function MobileNav() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const { trips } = usePlaces()
  const [sheet, setSheet] = useState<'add' | 'more' | null>(null)
  const current = pickCurrentTrip(trips)
  const tripPath = current ? `/voyages/${current.id}` : '/voyages'

  // Changer de page ferme la feuille ouverte
  useEffect(() => setSheet(null), [location.pathname, location.search])

  useEffect(() => {
    if (!sheet) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [sheet])

  const go = (path: string) => {
    setSheet(null)
    navigate(path)
  }

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-[1000] border-t border-line bg-[color-mix(in_srgb,var(--surface-solid)_92%,transparent)] shadow-[0_-4px_18px_rgba(0,0,0,0.06)] backdrop-blur-2xl backdrop-saturate-150 sm:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto grid h-16 max-w-md grid-cols-5 items-center px-2">
          <Item to="/" end label={t('mobile.home')} icon={<HomeIcon />} />
          <Item to={tripPath} label={t('mobile.trip')} icon={<RouteIcon size={21} />} match="/voyages" />
          <div className="flex justify-center">
            <button
              onClick={() => setSheet(sheet === 'add' ? null : 'add')}
              className="btn-accent -mt-7 flex h-14 w-14 items-center justify-center rounded-full border shadow-[var(--shadow-md)] transition-transform active:scale-95"
              aria-label={t('mobile.add')}
            >
              <PlusIcon size={26} className={`transition-transform ${sheet === 'add' ? 'rotate-45' : ''}`} />
            </button>
          </div>
          <Item to="/idees" label={t('nav.ideas')} icon={<SparkIcon size={21} />} />
          <button
            onClick={() => setSheet(sheet === 'more' ? null : 'more')}
            className={`flex flex-col items-center gap-1 py-1 text-[10.5px] font-medium ${
              sheet === 'more' ? 'text-accent' : 'text-text-muted'
            }`}
          >
            <MoreIcon />
            {t('mobile.more')}
          </button>
        </div>
      </nav>

      {sheet && (
        <div className="fixed inset-0 z-[1100] isolate touch-none overscroll-contain bg-[#120d09]/50 backdrop-blur-[2px] sm:hidden" onClick={() => setSheet(null)}>
          <div
            className="panel-enter absolute inset-x-0 bottom-0 max-h-[92dvh] touch-auto overflow-y-auto overscroll-contain rounded-t-[28px] border-t border-line bg-bg px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3 shadow-[var(--shadow-lg)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line-strong" />
            {sheet === 'add' ? (
              <QuickAdd tripId={current?.id ?? null} go={go} />
            ) : (
              <More go={go} />
            )}
          </div>
        </div>
      )}
    </>
  )
}

function Item({
  to,
  label,
  icon,
  end,
  match,
}: {
  to: string
  label: string
  icon: React.ReactNode
  end?: boolean
  match?: string
}) {
  const location = useLocation()
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex flex-col items-center gap-1 py-1 text-[10.5px] font-medium transition-colors ${
          isActive || (match && location.pathname.startsWith(match)) ? 'text-accent' : 'text-text-muted'
        }`
      }
    >
      {icon}
      {label}
    </NavLink>
  )
}

function QuickAdd({ tripId, go }: { tripId: string | null; go: (path: string) => void }) {
  const { t } = useI18n()
  const trip = (tab: string) => (tripId ? `/voyages/${tripId}?onglet=${tab}&ajout=1` : '/voyages?nouveau=1')
  const actions: { label: Key; hint: Key; icon: React.ReactNode; path: string; accent?: boolean }[] = [
    { label: 'quick.link', hint: 'quick.linkHint', icon: <LinkIcon size={20} />, path: '/idees', accent: true },
    { label: 'quick.todo', hint: 'quick.todoHint', icon: <ListIcon size={20} />, path: trip('todo') },
    { label: 'quick.doc', hint: 'quick.docHint', icon: <ShieldIcon size={20} />, path: trip('docs') },
    { label: 'quick.stop', hint: 'quick.stopHint', icon: <RouteIcon size={20} />, path: trip('route') },
    { label: 'quick.photo', hint: 'quick.photoHint', icon: <PinIcon size={20} />, path: '/carte' },
    { label: 'quick.expense', hint: 'quick.expenseHint', icon: <WalletIcon size={20} />, path: '/depenses' },
  ]
  return (
    <div>
      <p className="eyebrow eyebrow-dot mb-4">{t('quick.title')}</p>
      <div className="grid grid-cols-2 gap-3">
        {actions.map((a, i) => (
          <button
            key={a.label}
            onClick={() => go(a.path)}
            className={`${a.accent ? 'card-feature col-span-2' : 'card'} flex items-center gap-3 p-4 text-left active:scale-[0.98] ${
              i === 0 ? '' : ''
            }`}
          >
            <span className="glyph h-11 w-11">{a.icon}</span>
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold leading-tight">{t(a.label)}</span>
              <span className="mt-0.5 block text-[12px] leading-snug text-text-muted">{t(a.hint)}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function More({ go }: { go: (path: string) => void }) {
  const { t } = useI18n()
  const { mode, setMode, advanced } = useMode()
  const { theme, toggle } = useTheme()
  const { signOut } = useAuth()
  const links: { path: string; label: Key; icon: React.ReactNode; advancedOnly?: boolean }[] = [
    { path: '/coffre', label: 'nav.vault', icon: <span className="text-[18px] leading-none">🔐</span> },
    { path: '/voyages', label: 'nav.trips', icon: <RouteIcon size={18} /> },
    { path: '/carte', label: 'nav.map', icon: <PinIcon size={18} /> },
    { path: '/bucketlist', label: 'nav.wishlist', icon: <SparkIcon size={18} /> },
    { path: '/galerie', label: 'nav.gallery', icon: <FileIcon size={18} />, advancedOnly: true },
    { path: '/planificateur', label: 'nav.planner', icon: <SparkIcon size={18} />, advancedOnly: true },
    { path: '/hebergements', label: 'nav.stays', icon: <span className="text-[18px] leading-none">🏨</span> },
    { path: '/evenements', label: 'nav.events', icon: <CalendarIcon size={18} /> },
    { path: '/parcours', label: 'nav.route', icon: <span className="text-[18px] leading-none">🥾</span> },
    { path: '/depenses', label: 'nav.expenses', icon: <WalletIcon size={18} /> },
    { path: '/profil', label: 'nav.profile', icon: <ShareIcon2 /> },
  ]
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-2">
        {links
          .filter((l) => advanced || !l.advancedOnly)
          .map((l) => (
            <button key={l.path} onClick={() => go(l.path)} className="card flex flex-col items-center gap-2 px-2 py-4">
              <span className="text-accent">{l.icon}</span>
              <span className="text-[12px] font-medium">{t(l.label)}</span>
            </button>
          ))}
      </div>

      <div className="card p-4">
        <p className="label">{t('mode.title')}</p>
        <div className="grid grid-cols-2 gap-2">
          {(['simple', 'advanced'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-2xl border px-3 py-3 text-left ${
                mode === m ? 'border-accent bg-[var(--halo)]' : 'border-line'
              }`}
            >
              <span className="block text-[14px] font-semibold">{t(m === 'simple' ? 'mode.simple' : 'mode.advanced')}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-text-muted">
                {t(m === 'simple' ? 'mode.simpleHint' : 'mode.advancedHint')}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={toggle} className="btn flex-1">
          {theme === 'dark' ? t('mode.light') : t('mode.dark')}
        </button>
        <button onClick={() => void signOut()} className="btn btn-quiet flex-1 gap-2" aria-label={t('nav.signOut')} title={t('nav.signOut')}>
          <LogoutIcon size={18} />
          {t('nav.signOut')}
        </button>
      </div>
    </div>
  )
}

function HomeIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1v-8.5Z" />
    </svg>
  )
}
function MoreIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden>
      <circle cx="5.5" cy="12" r="1.3" fill="currentColor" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.3" fill="currentColor" />
    </svg>
  )
}
function ShareIcon2() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  )
}
