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
function pinSvg(fill: string, dashed = false): string {
  return `<svg viewBox="0 0 26 34" width="26" height="34" xmlns="http://www.w3.org/2000/svg">
    <path d="M13 1.6c-6.1 0-11 4.9-11 11 0 8 9.4 18.8 9.8 19.2a1.6 1.6 0 0 0 2.4 0c.4-.4 9.8-11.2 9.8-19.2 0-6.1-4.9-11-11-11z"
      fill="${fill}"
      stroke="var(--bg)"
      stroke-width="2"
      ${dashed ? 'stroke-dasharray="3 3"' : ''} />
    <circle cx="13" cy="12.4" r="4.1" fill="var(--bg)" />
  </svg>`
}

function pin(html: string, extra = ''): L.DivIcon {
  return L.divIcon({
    html,
    className: `pin ${extra}`,
    iconSize: [26, 34],
    // La pointe du pin doit tomber sur la coordonnee, pas son centre
    iconAnchor: [13, 33],
    popupAnchor: [0, -30],
    tooltipAnchor: [0, -30],
  })
}

export const placeIcon = pin(pinSvg('var(--accent)'))
export const wishIcon = pin(pinSvg('transparent', true), 'pin-wish')
export const draftIcon = pin(pinSvg('var(--color-ochre)', true), 'pin-draft')

/** Halo pose sous le marqueur selectionne, hors grappe. */
export const haloIcon = L.divIcon({
  html: '<span class="halo-ring"></span>',
  className: 'halo',
  iconSize: [46, 46],
  iconAnchor: [23, 23],
})

/** Grappe : le diametre suit le nombre de points, sans jamais devenir enorme. */
export function clusterIcon(count: number): L.DivIcon {
  const size = count < 10 ? 34 : count < 50 ? 40 : count < 200 ? 46 : 52
  return L.divIcon({
    html: `<div class="cluster" style="width:${size}px;height:${size}px">${count}</div>`,
    className: 'cluster-wrap',
    iconSize: L.point(size, size, true),
  })
}
