import { NavLink, Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../context/AuthContext'
import ThemeToggle from './ThemeToggle'

const NAV = [
  { to: '/', label: 'Carnet', end: true },
  { to: '/voyages', label: 'Voyages' },
  { to: '/carte', label: 'Carte' },
  { to: '/bucketlist', label: 'Envies' },
  { to: '/galerie', label: 'Galerie' },
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
  const name = profile?.display_name || user?.email?.split('@')[0] || 'Voyageur'

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-[900] border-b border-line bg-bg/85 backdrop-blur-xl">
        <div
          className={`mx-auto flex h-16 items-center gap-6 px-5 sm:px-8 ${
            wide ? 'max-w-none' : 'max-w-6xl'
          }`}
        >
          <Link to="/" className="flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full bg-accent" />
            <span className="display-sm text-xl">BuBuTravel</span>
          </Link>

          <nav className="hidden items-center gap-1 sm:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-full px-3.5 py-1.5 text-[13px] transition-colors ${
                    isActive
                      ? 'bg-surface-2 text-text'
                      : 'text-text-muted hover:bg-surface-2 hover:text-text'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Link
              to="/profil"
              className="hidden items-center gap-2 rounded-full border border-line py-1 pl-1 pr-3.5 transition-colors hover:border-line-strong sm:flex"
            >
              <Avatar url={profile?.avatar_url} name={name} size={26} />
              <span className="max-w-28 truncate text-[13px] text-text-soft">{name}</span>
            </Link>
            <button onClick={() => void signOut()} className="btn btn-quiet btn-xs">
              Sortir
            </button>
          </div>
        </div>

        {/* Navigation repliee sur petit ecran */}
        <nav className="flex gap-1 overflow-x-auto border-t border-line px-4 py-2 sm:hidden">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `shrink-0 rounded-full px-3.5 py-1.5 text-[13px] transition-colors ${
                  isActive ? 'bg-surface-2 text-text' : 'text-text-muted'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="flex-1">{children}</main>
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
