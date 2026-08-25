/**
 * Drapeaux dessines en SVG, pas en emoji ni en lettres : un emoji drapeau ne
 * s'affiche pas sur Windows, qui le rend en deux lettres, et « FR / EN » est
 * justement ce qu'il fallait eviter.
 */
type Props = { size?: number; className?: string }

export function FlagFR({ size = 22, className = '' }: Props) {
  return (
    <svg
      viewBox="0 0 24 16"
      width={size}
      height={(size * 16) / 24}
      className={className}
      role="img"
      aria-label="Francais"
    >
      <rect width="24" height="16" fill="#f2f2f2" />
      <rect width="8" height="16" fill="#0055a4" />
      <rect x="16" width="8" height="16" fill="#ef4135" />
    </svg>
  )
}

export function FlagEN({ size = 22, className = '' }: Props) {
  const h = (size * 16) / 24
  return (
    <svg
      viewBox="0 0 24 16"
      width={size}
      height={h}
      className={className}
      role="img"
      aria-label="English"
    >
      <rect width="24" height="16" fill="#012169" />
      {/* Croix de Saint-Andre, blanche puis rouge */}
      <path d="M0 0 L24 16 M24 0 L0 16" stroke="#fff" strokeWidth="3.2" />
      <path d="M0 0 L24 16 M24 0 L0 16" stroke="#c8102e" strokeWidth="1.6" />
      {/* Croix de Saint-Georges */}
      <path d="M12 0 V16 M0 8 H24" stroke="#fff" strokeWidth="5.4" />
      <path d="M12 0 V16 M0 8 H24" stroke="#c8102e" strokeWidth="3.2" />
    </svg>
  )
}

export function Flag({ lang, size, className }: Props & { lang: 'fr' | 'en' }) {
  return lang === 'fr' ? (
    <FlagFR size={size} className={className} />
  ) : (
    <FlagEN size={size} className={className} />
  )
}
