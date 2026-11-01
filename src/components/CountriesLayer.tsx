import { useEffect, useMemo, useState } from 'react'
import { GeoJSON, useMap, useMapEvents } from 'react-leaflet'
import type L from 'leaflet'
import type { FeatureCollection, Geometry } from 'geojson'
import { loadCountries, sameCountry } from '../lib/worldCountries'
import type { CountryFeature, CountryProps } from '../lib/worldCountries'
import type { Place } from '../lib/types'

export type CountryMode = 'all' | 'visited' | 'wishlist'

type Stat = { visited: number; wish: number; planned: boolean }

/**
 * Pays remplis selon l'activite, et selon le choix « Visité / À visiter » :
 *  - les deux : plus il y a d'activites, plus c'est dense ; un pays dont
 *    tout est fait passe en dore ;
 *  - « Visité » : les pays ou l'on est alle s'illuminent (dore lumineux),
 *    d'autant plus que la part deja faite est grande ;
 *  - « À visiter » : seulement ce qu'il reste a faire, en corail.
 * Un tap sur un pays le cadre et ouvre sa liste.
 */
export default function CountriesLayer({
  places,
  mode = 'all',
  extraCountries = [],
  interactive = true,
  onCountry,
}: {
  places: Place[]
  mode?: CountryMode
  /** Pays du voyage sans lieu encore (etapes) : teintes legerement. */
  extraCountries?: string[]
  interactive?: boolean
  onCountry: (props: CountryProps, bounds: L.LatLngBounds) => void
}) {
  const map = useMap()
  // En zoom rapproche (ville), le pays colore recouvrirait les rues : on
  // efface le remplissage et on garde un contour discret.
  const [zoom, setZoom] = useState(() => map.getZoom())
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) })
  const fade = zoom >= 9 ? 0.12 : zoom >= 7 ? 0.45 : 1
  const [world, setWorld] = useState<FeatureCollection<Geometry, CountryProps> | null>(null)

  useEffect(() => {
    let active = true
    loadCountries()
      .then((fc) => active && setWorld(fc))
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  const stats = useMemo(() => {
    const map = new Map<string, Stat>()
    if (!world) return map
    for (const f of world.features) {
      const mine = places.filter((p) => p.country && sameCountry(f.properties, p.country))
      const visited = mine.filter((p) => p.status !== 'wishlist').length
      const wish = mine.length - visited
      const planned = extraCountries.some((c) => sameCountry(f.properties, c))
      if (mine.length > 0 || planned) map.set(f.properties.code || f.properties.nameEn, { visited, wish, planned })
    }
    return map
  }, [world, places, extraCountries])

  // Ce qui compte dans le mode choisi
  const shown = (s: Stat) => (mode === 'visited' ? s.visited : mode === 'wishlist' ? s.wish : s.visited + s.wish)
  const visible = (s: Stat) => shown(s) > 0 || (mode !== 'visited' && s.planned)

  const data = useMemo(() => {
    if (!world) return null
    return {
      ...world,
      features: world.features.filter((f) => {
        const s = stats.get(f.properties.code || f.properties.nameEn)
        return s ? visible(s) : false
      }),
    } as FeatureCollection<Geometry, CountryProps>
  }, [world, stats, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return null
  const max = Math.max(1, ...[...stats.values()].map(shown))
  const signature =
    `z${fade}` + mode + [...stats.entries()].map(([k, v]) => `${k}:${v.visited}/${v.wish}`).join(',') + (interactive ? 'i' : '')

  return (
    <GeoJSON
      key={signature}
      data={data}
      style={(f) => {
        const props = (f as CountryFeature).properties
        const s = stats.get(props.code || props.nameEn) ?? { visited: 0, wish: 0, planned: false }
        const n = shown(s)
        const total = s.visited + s.wish
        const done = total > 0 ? s.visited / total : 0
        const complete = total > 0 && s.visited === total
        // Echelle logarithmique : le 10e lieu compte moins que le 1er
        const level = n === 0 ? 0 : Math.log(1 + n) / Math.log(1 + max)

        if (mode === 'visited') {
          return {
            className: complete ? 'country-glow country-complete' : 'country-glow',
            color: '#ffb020',
            weight: complete ? 2.6 : 1.8,
            opacity: 1,
            fillColor: complete ? '#ffcf4d' : '#ffb84d',
            fillOpacity: (0.28 + 0.32 * level + 0.25 * done) * fade,
          }
        }
        if (mode === 'wishlist') {
          return {
            className: 'country-wish',
            color: '#e2522c',
            weight: 1.3,
            opacity: 0.9,
            fillColor: '#ff7f57',
            fillOpacity: (n === 0 ? 0.08 : 0.14 + 0.46 * level) * fade,
          }
        }
        // Les deux : densite = activite, et la part deja faite rechauffe vers le dore
        return {
          className: complete ? 'country-glow country-complete' : '',
          color: complete ? '#ffb020' : '#e2522c',
          weight: complete ? 2.4 : 1.2,
          opacity: 0.9,
          fillColor: complete ? '#ffc23d' : done > 0 ? '#ff9a3c' : '#ff7f57',
          fillOpacity: (n === 0 ? 0.08 : Math.min(0.85, 0.14 + 0.42 * level + 0.25 * done)) * fade,
        }
      }}
      interactive={interactive}
      onEachFeature={(f, layer) => {
        const props = (f as CountryFeature).properties
        const path = layer as L.Path & { getBounds: () => L.LatLngBounds }
        let base = 1.2
        path.on('add', () => {
          base = (path.options.weight as number) ?? 1.2
          // Leaflet n'applique pas className via setStyle : on pose les
          // classes (lueur, respiration) directement sur l'element SVG.
          const cls = (path.options as { className?: string }).className
          const el = (path as unknown as { getElement?: () => Element | undefined }).getElement?.()
          if (cls && el) for (const c of cls.split(' ').filter(Boolean)) el.classList.add(c)
        })
        path.on('click', (e) => {
          // Le clic ne doit pas atteindre la carte (ajout de lieu, etc.)
          ;(e as L.LeafletMouseEvent).originalEvent?.stopPropagation()
          map.fitBounds(path.getBounds(), { padding: [40, 40], maxZoom: 7 })
          onCountry(props, path.getBounds())
        })
        path.on('mouseover', () => path.setStyle({ weight: base + 1.2 }))
        path.on('mouseout', () => path.setStyle({ weight: base }))
      }}
    />
  )
}
