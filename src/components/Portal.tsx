import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

/**
 * Sort une fenetre (feuille, tiroir, menu) du reste de la page et la pose
 * directement dans <body>. Sans ca, une fenetre « fixed » placee dans un
 * parent flou, anime ou filtre n'est plus calee sur l'ecran, et la barre du
 * bas ou le contenu derriere restent cliquables au travers.
 */
export default function Portal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null
  return createPortal(children, document.body)
}
