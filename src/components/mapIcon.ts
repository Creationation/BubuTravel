import L from 'leaflet'

/**
 * Icone en divIcon plutot que l'icone par defaut de Leaflet : celle-ci pointe
 * vers des PNG resolus en CSS, que Vite ne sait pas suivre depuis node_modules
 * (le classique marqueur invisible / 404 marker-icon.png).
 *
 * Trait noir epais et ombre dure portee, comme le reste de l'interface.
 */
function svgPin(fill: string): string {
  return `
    <svg width="30" height="40" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">
      <path d="M17 3.6C10 3.6 4.4 9.2 4.4 16.2c0 9.1 10.9 21.9 11.4 22.4a1.6 1.6 0 0 0 2.4 0c.5-.5 11.4-13.3 11.4-22.4C29.6 9.2 24 3.6 17 3.6z"
            fill="#000"/>
      <path d="M14 1C7 1 1.4 6.6 1.4 13.6c0 9.1 10.9 21.9 11.4 22.4a1.6 1.6 0 0 0 2.4 0c.5-.5 11.4-13.3 11.4-22.4C26.6 6.6 21 1 14 1z"
            fill="${fill}" stroke="#000" stroke-width="2"/>
      <circle cx="14" cy="13.4" r="4.4" fill="#fff" stroke="#000" stroke-width="2"/>
    </svg>`
}

function makeIcon(fill: string, className: string) {
  return L.divIcon({
    html: svgPin(fill),
    className,
    iconSize: [30, 40],
    iconAnchor: [14, 37],
    popupAnchor: [0, -34],
  })
}

export const placeIcon = makeIcon('#ff90e8', 'bubu-pin')
export const activeIcon = makeIcon('#ffc900', 'bubu-pin bubu-pin-active')
export const draftIcon = makeIcon('#23a094', 'bubu-pin bubu-pin-draft')
