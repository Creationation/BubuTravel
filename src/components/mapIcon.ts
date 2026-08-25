import L from 'leaflet'

/**
 * Marqueurs en divIcon : l'icone par defaut de Leaflet pointe vers des PNG
 * resolus en CSS, que Vite ne suit pas depuis node_modules, d'ou le classique
 * marqueur invisible. Un divIcon suit aussi les variables de theme, donc les
 * marqueurs changent avec le mode clair et sombre.
 *
 * IMPORTANT : ces icones ne doivent JAMAIS changer apres la creation du
 * marqueur. Appeler setIcon sur un marqueur qui vit dans une grappe le fait
 * disparaitre, Leaflet.markercluster ne retrouvant plus son element. L'etat
 * selectionne est donc rendu par une couche separee, en dehors des grappes.
 */

/** Dessin commun : une punaise droite, tete ronde et aiguille fine. */
export function pinSvg(fill: string, hollow = false, dashed = false, size = 1): string {
  const w = Math.round(22 * size)
  const h = Math.round(30 * size)

  // Le coeur creux distingue l'envie du lieu visite meme sans la couleur
  const heart = hollow
    ? '<circle cx="11" cy="9" r="3.2" fill="none" stroke="var(--bg)" stroke-width="2.1" />'
    : ''

  return `<svg viewBox="0 0 22 30" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <!-- Aiguille : effilee vers la pointe, qui tombe pile sur la coordonnee -->
    <path d="M10.25 14 L11 29.4 L11.75 14 Z" fill="var(--text-muted)" />
    <path d="M11 14 L11 29.4" stroke="var(--bg)" stroke-width="0.5" opacity="0.5" />

    <!-- Tete -->
    <circle cx="11" cy="9" r="7.4"
      fill="${fill}"
      stroke="var(--bg)"
      stroke-width="1.8"
      ${dashed ? 'stroke-dasharray="2.6 2.6"' : ''} />

    <!-- Reflet : ce qui fait lire une bille plutot qu'un rond plat -->
    <ellipse cx="8.4" cy="6.2" rx="2.4" ry="1.7" fill="#fff" opacity="0.34"
      transform="rotate(-28 8.4 6.2)" />

    ${heart}
  </svg>`
}

/**
 * Le dessin reste petit, la zone cliquable ne l'est pas.
 *
 * Une punaise de 22 par 30 est agreable a l'oeil mais penible a viser, au
 * doigt comme a la souris. L'icone occupe donc 40 par 44, dont la marge est
 * transparente : la cible respecte le seuil confortable, sans alourdir la
 * carte.
 */
const HIT_W = 40
const HIT_H = 44

function pin(html: string, extra = ''): L.DivIcon {
  return L.divIcon({
    html: `<span class="pin-hit">${html}</span>`,
    className: `pin ${extra}`,
    iconSize: [HIT_W, HIT_H],
    // La pointe de l'aiguille tombe sur la coordonnee, pas le centre du cadre
    iconAnchor: [HIT_W / 2, HIT_H - 7],
    popupAnchor: [0, -HIT_H + 12],
    tooltipAnchor: [0, -HIT_H + 12],
  })
}

/** Lieu deja visite : terracotta, tete pleine. */
export const placeIcon = pin(pinSvg('var(--color-clay)'))
/** Envie a visiter : olive, tete percee. */
export const wishIcon = pin(pinSvg('var(--color-olive)', true), 'pin-wish')
/** Marqueur provisoire, le temps de valider le formulaire. */
export const draftIcon = pin(pinSvg('var(--color-ochre)', false, true), 'pin-draft')

/** Halo pose sous le marqueur selectionne, hors grappe. */
export const haloIcon = L.divIcon({
  html: '<span class="halo-ring"></span>',
  className: 'halo',
  iconSize: [38, 38],
  iconAnchor: [19, 19],
})

/** Grappe : le diametre suit le nombre de points, sans jamais devenir enorme. */
export function clusterIcon(count: number): L.DivIcon {
  const size = count < 10 ? 32 : count < 50 ? 38 : count < 200 ? 44 : 50
  return L.divIcon({
    html: `<div class="cluster" style="width:${size}px;height:${size}px">${count}</div>`,
    className: 'cluster-wrap',
    iconSize: L.point(size, size, true),
  })
}
