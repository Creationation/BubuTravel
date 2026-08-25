import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

/**
 * Sans garde-fou, la moindre erreur de rendu laisse une page blanche sans
 * explication. Ici l'erreur est affichee et l'app reste quittable.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[bubutravel] erreur de rendu', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex min-h-full items-center justify-center px-5 py-16">
        <div className="panel w-full max-w-md p-8 text-center">
          <span className="mx-auto mb-6 flex h-14 w-11 items-end justify-center rounded-t-full border border-line bg-surface-2 pb-2.5">
            <span className="h-2 w-2 rotate-45 border border-accent" />
          </span>
          <h1 className="display-sm text-2xl">Quelque chose a lache</h1>
          <p className="lede mt-3 text-[14px]">
            L'affichage s'est arrete net. Recharger la page suffit presque toujours.
          </p>

          <p className="notice notice-bad mt-5 break-words text-left font-mono text-[11px]">
            {error.message}
          </p>

          <div className="mt-6 flex justify-center gap-2">
            <button onClick={() => window.location.reload()} className="btn btn-accent">
              Recharger
            </button>
            <a href="/" className="btn">
              Retour au carnet
            </a>
          </div>
        </div>
      </div>
    )
  }
}
