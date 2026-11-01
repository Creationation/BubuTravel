import { NavLink, Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../context/AuthContext'
import ThemeToggle from './ThemeToggle'
import DraftsButton from './DraftsDrawer'
import MobileNav from './MobileNav'
import { useMode } from '../context/ModeContext'
import { useT } from '../i18n/I18nContext'
import type { Key } from '../i18n/fr'
import { ReviewHost } from './ReviewSheet'

const NAV: { to: string; label: Key; end?: boolean; advanced?: boolean }[] = [
  { to: '/', label: 'nav.journal', end: true },
  { to: '/voyages', label: 'nav.trips' },
  { to: '/carte', label: 'nav.map' },
  { to: '/bucketlist', label: 'nav.wishlist' },
  { to: '/idees', label: 'nav.ideas' },
  { to: '/planificateur', label: 'nav.planner', advanced: true },
  { to: '/evenements', label: 'nav.events', advanced: true },
  { to: '/galerie', label: 'nav.gallery', advanced: true },
]

/** Coquille commune : en-tete fixe, navigation, bascule de theme. */
export default function AppShell({
  children,
  wide = false,
}: {
  children: ReactNode
  wide?: boolean
}) {
  const { profile, user, signOut } = useAuth()
  const t = useT()
  const { advanced } = useMode()
  const nav = NAV.filter((item) => advanced || !item.advanced)
  const name = profile?.display_name || user?.email?.split('@')[0] || t('common.traveller')

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-[900] border-b border-line bg-[color-mix(in_srgb,var(--surface-solid)_45%,transparent)] backdrop-blur-2xl backdrop-saturate-150">
        <div
          className={`mx-auto flex h-16 items-center gap-4 px-5 sm:px-8 ${
            wide ? 'max-w-none' : 'max-w-6xl'
          }`}
        >
          <Link to="/" className="flex shrink-0 items-center gap-2.5">
            <span className="h-2 w-2 rounded-full bg-accent" />
            <span className="display-sm text-xl">{t('app.name')}</span>
          </Link>

          <nav className="nav-scroll hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto sm:flex">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `shrink-0 rounded-full px-3 py-1.5 text-[13px] transition-colors ${
                    isActive
                      ? 'bg-surface-2 text-text'
                      : 'text-text-muted hover:bg-surface-2 hover:text-text'
                  }`
                }
              >
                {t(item.label)}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <DraftsButton />
            <span className="hidden sm:inline-flex">
              <ThemeToggle />
            </span>
            <Link
              to="/profil"
              className="hidden items-center gap-2 rounded-full border border-line py-1 pl-1 pr-3.5 transition-colors hover:border-line-strong sm:flex"
            >
              <Avatar url={profile?.avatar_url} name={name} size={26} />
              <span className="max-w-28 truncate text-[13px] text-text-soft">{name}</span>
            </Link>
            <button onClick={() => void signOut()} className="btn btn-quiet btn-xs hidden sm:inline-flex">
              {t('nav.signOut')}
            </button>
          </div>
        </div>

      </header>

      <main className="flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] sm:pb-0">{children}</main>
      <MobileNav />
      <ReviewHost />
    </div>
  )
}

export function Avatar({
  url,
  name,
  size = 40,
}: {
  url?: string | null
  name: string
  size?: number
}) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-surface-2"
      style={{ width: size, height: size }}
    >
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="display-sm text-text-muted" style={{ fontSize: size * 0.42 }}>
          {name.charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  )
}
