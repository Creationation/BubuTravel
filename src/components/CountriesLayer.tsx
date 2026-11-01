import { useEffect, useMemo, useState } from 'react'
import { GeoJSON, useMap } from 'react-leaflet'
import type L from 'leaflet'
import type { FeatureCollection, Geometry } from 'geojson'
import { loadCountries, sameCountry } from '../lib/worldCountries'
import type { CountryFeature, CountryProps } from '../lib/worldCountries'
import type { Place } from '../lib/types'

/**
 * Pays remplis selon l'activite : plus il y a de lieux (a visiter et deja
 * visites) dans un pays, plus sa couleur est dense. Un tap sur un pays le
 * cadre et ouvre sa liste (a faire / deja fait).
 */
export default function CountriesLayer({
  places,
  extraCountries = [],
  interactive = true,
  onCountry,
}: {
  places: Place[]
  /** Pays du voyage sans lieu encore (etapes) : remplis legerement. */
  extraCountries?: string[]
  interactive?: boolean
  onCountry: (props: CountryProps, bounds: L.LatLngBounds) => void
}) {
  const map = useMap()
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

  // Nombre de lieux par pays (cle = code ISO du contour)
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    if (!world) return map
    for (const f of world.features) {
      const n = places.filter((p) => p.country && sameCountry(f.properties, p.country)).length
      const planned = extraCountries.some((c) => sameCountry(f.properties, c))
      if (n > 0 || planned) map.set(f.properties.code || f.properties.nameEn, n)
    }
    return map
  }, [world, places, extraCountries])

  const data = useMemo(() => {
    if (!world) return null
    // On ne dessine que les pays concernes : la carte reste lisible
    return {
      ...world,
      features: world.features.filter((f) => counts.has(f.properties.code || f.properties.nameEn)),
    } as FeatureCollection<Geometry, CountryProps>
  }, [world, counts])

  if (!data) return null
  const max = Math.max(1, ...counts.values())
  const signature = [...counts.entries()].map(([k, v]) => `${k}:${v}`).join(',') + (interactive ? 'i' : '')

  return (
    <GeoJSON
      key={signature}
      data={data}
      style={(f) => {
        const props = (f as CountryFeature).properties
        const n = counts.get(props.code || props.nameEn) ?? 0
        // Echelle logarithmique : le 10e lieu compte moins que le 1er
        const level = n === 0 ? 0 : Math.log(1 + n) / Math.log(1 + max)
        return {
          color: '#e2522c',
          weight: 1.2,
          opacity: 0.85,
          fillColor: '#ff7f57',
          fillOpacity: n === 0 ? 0.08 : 0.14 + 0.46 * level,
        }
      }}
      interactive={interactive}
      onEachFeature={(f, layer) => {
        const props = (f as CountryFeature).properties
        const path = layer as L.Path & { getBounds: () => L.LatLngBounds }
        path.on('click', (e) => {
          // Le clic ne doit pas atteindre la carte (ajout de lieu, etc.)
          ;(e as L.LeafletMouseEvent).originalEvent?.stopPropagation()
          // On se rapproche du pays, sans zoomer jusqu'a la rue
          map.fitBounds(path.getBounds(), { padding: [40, 40], maxZoom: 7 })
          onCountry(props, path.getBounds())
        })
        path.on('mouseover', () => path.setStyle({ weight: 2.4 }))
        path.on('mouseout', () => path.setStyle({ weight: 1.2 }))
      }}
    />
  )
}
