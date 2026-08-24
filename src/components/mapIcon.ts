import L from 'leaflet'

/**
 * Marqueurs en divIcon : l'icone par defaut de Leaflet pointe vers des PNG
 * resolus en CSS, que Vite ne suit pas depuis node_modules, d'ou le classique
 * marqueur invisible. Un divIcon a l'avantage de suivre les variables de
 * theme, donc les marqueurs changent avec le mode clair et sombre.
 */
function pin(extra = ''): L.DivIcon {
  return L.divIcon({
    html: '<span class="pin-dot"></span>',
    className: `pin ${extra}`,
    iconSize: [15, 15],
    iconAnchor: [7.5, 7.5],
    popupAnchor: [0, -10],
  })
}

export const placeIcon = pin()
export const activeIcon = pin('pin-active')
export const draftIcon = pin('pin-draft')
export const wishIcon = pin('pin-wish')

/** Grappe : le diametre suit le nombre de points, sans jamais devenir enorme. */
export function clusterIcon(count: number): L.DivIcon {
  const size = count < 10 ? 34 : count < 50 ? 40 : count < 200 ? 46 : 52
  return L.divIcon({
    html: `<div class="cluster" style="width:${size}px;height:${size}px">${count}</div>`,
    className: 'cluster-wrap',
    iconSize: L.point(size, size, true),
  })
}
