import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  Tooltip,
  ZoomControl,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import type L from 'leaflet'
import type { ReactNode } from 'react'
import { useTheme } from '../context/ThemeContext'
import { clusterIcon, draftIcon, haloIcon, placeIcon, wishIcon } from './mapIcon'
import type { TrackPoint } from '../lib/types'
import { countryName } from '../lib/countryName'

type Point = {
  id: string
  lat: number
  lng: number
  name: string
  country: string
  /** Lieu de la bucketlist : marqueur creux au lieu du marqueur plein. */
  wish?: boolean
}
type TrackLine = { id: string; name: string; points: TrackPoint[] }

type Props = {
  points: Point[]
  activeId?: string | null
  onSelect?: (id: string) => void
  /**
   * Appele quand plusieurs lieux se superposent sous le clic. Sans ca, la
   * zone cliquable elargie ferait ouvrir le voisin plutot que celui vise.
   */
  onAmbiguous?: (ids: string[]) => void
  draft?: { lat: number; lng: number } | null
  picking?: boolean
  onMapClick?: (lat: number, lng: number) => void
  focus?: [number, number] | null
  autoFit?: boolean
  cluster?: boolean
  minZoom?: number
  tracks?: TrackLine[]
  liveTrack?: TrackPoint[] | null
  onTrackSelect?: (id: string) => void
  children?: ReactNode
  /** Cadrage initial prioritaire (ex. les etapes du voyage en cours). */
  fitTo?: { lat: number; lng: number }[]
}

const WORLD_CENTER: [number, number] = [28, 8]

/**
 * Deux marqueurs plus proches que ce rayon a l'ecran sont indissociables au
 * clic. La valeur suit la moitie de la zone cliquable : au-dela, les cibles
 * ne se recouvrent plus.
 */
const AMBIGUOUS_RADIUS_PX = 20

/**
 * En dessous de cette distance reelle, zoomer ne separera jamais vraiment
 * les marqueurs : meme au zoom maximum ils resteront colles. C'est la, et la
 * seulement, qu'il faut demander lequel ouvrir. Au-dessus, on zoome, parce
 * que c'est ce qu'attend quiconque clique sur une grappe.
 */
const TIGHT_CLUSTER_METRES = 60

/**
 * Fond de carte CARTO : deux styles accordes aux deux themes, libres d'usage
 * et sans cle API, contrairement a Mapbox.
 *
 * Deux precautions de performance, apprises a l'usage :
 *   - les marqueurs sont memorises et ne dependent PAS de la selection, sinon
 *     chaque clic changeait l'icone d'un marqueur vivant dans une grappe, ce
 *     que Leaflet.markercluster ne sait pas faire : le marqueur disparaissait
 *     et laissait un element orphelin derriere lui, jusqu'a bloquer la carte ;
 *   - le composant est memo, pour que l'ouverture d'un panneau lateral ne
 *     redessine pas toute la couche de marqueurs.
 */
function MapCanvasInner({
  points,
  activeId,
  onSelect,
  onAmbiguous,
  draft,
  picking = false,
  onMapClick,
  focus,
  autoFit = true,
  cluster = true,
  minZoom = 2,
  tracks = [],
  liveTrack = null,
  onTrackSelect,
  children,
  fitTo,
}: Props) {
  const { theme } = useTheme()
  // CARTO exige une cle API depuis l'automne 2026 (tuiles « API KEY
  // REQUIRED »). On prend les tuiles OpenStreetMap, sans cle ; le theme
  // sombre est obtenu par filtre CSS (voir .leaflet-tile-pane dans index.css).
  const tileUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

  // Les gestionnaires passent par des references : leur nouvelle identite a
  // chaque rendu suffirait sinon a faire remonter tous les marqueurs.
  const selectRef = useRef(onSelect)
  selectRef.current = onSelect
  const ambiguousRef = useRef(onAmbiguous)
  ambiguousRef.current = onAmbiguous
  const pointsRef = useRef(points)
  pointsRef.current = points
  const mapRef = useRef<L.Map | null>(null)

  /** Retrouve les lieux correspondant a une liste de marqueurs Leaflet. */
  function idsAt(latlngs: { lat: number; lng: number }[]): string[] {
    const ids: string[] = []
    for (const ll of latlngs) {
      const match = pointsRef.current.find(
        (p) => Math.abs(p.lat - ll.lat) < 1e-7 && Math.abs(p.lng - ll.lng) < 1e-7,
      )
      if (match && !ids.includes(match.id)) ids.push(match.id)
    }
    return ids
  }

  /**
   * Clic sur une grappe. Tant que zoomer separe encore les marqueurs, on
   * zoome, c'est ce qu'attend l'utilisateur. Mais quand la grappe est deja
   * resserree, zoomer n'apporte plus rien : on demande alors lequel ouvrir,
   * plutot que d'en desigher un au hasard ou d'eparpiller les marqueurs.
   */
  function handleClusterClick(event: {
    layer: {
      getBounds: () => L.LatLngBounds
      getAllChildMarkers: () => { getLatLng: () => L.LatLng }[]
    }
  }) {
    const map = mapRef.current
    if (!map) return

    const cluster = event.layer
    const bounds = cluster.getBounds()
    // Diagonale reelle de la grappe, en metres : independante du zoom courant
    const spreadMetres = bounds.getNorthWest().distanceTo(bounds.getSouthEast())

    const tight = spreadMetres <= TIGHT_CLUSTER_METRES || map.getZoom() >= map.getMaxZoom()
    if (tight && ambiguousRef.current) {
      const ids = idsAt(cluster.getAllChildMarkers().map((m) => m.getLatLng()))
      if (ids.length > 1) {
        ambiguousRef.current(ids)
        return
      }
      if (ids.length === 1) {
        selectRef.current?.(ids[0])
        return
      }
    }
    map.fitBounds(bounds, { padding: [60, 60] })
  }

  /**
   * Un clic sur un marqueur ne designe pas forcement un seul lieu : deux
   * adresses voisines, ou deux enregistrements au meme endroit, se
   * chevauchent a l'ecran. On regarde donc qui d'autre se trouve sous la
   * meme zone, en pixels et non en metres, puisque c'est bien la distance a
   * l'ecran qui rend le clic ambigu.
   */
  function handleMarkerClick(id: string) {
    const map = mapRef.current
    const all = pointsRef.current
    if (!map) {
      selectRef.current?.(id)
      return
    }

    const target = all.find((p) => p.id === id)
    if (!target) return

    const anchor = map.latLngToContainerPoint([target.lat, target.lng])
    const near = all.filter((p) => {
      const pt = map.latLngToContainerPoint([p.lat, p.lng])
      return anchor.distanceTo(pt) <= AMBIGUOUS_RADIUS_PX
    })

    if (near.length > 1 && ambiguousRef.current) {
      // Le lieu vise en premier, les voisins ensuite
      const ids = [id, ...near.filter((p) => p.id !== id).map((p) => p.id)]
      ambiguousRef.current(ids)
      return
    }
    selectRef.current?.(id)
  }

  const markers = useMemo(
    () =>
      points.map((p) => (
        <Marker
          key={p.id}
          position={[p.lat, p.lng]}
          icon={p.wish ? wishIcon : placeIcon}
          eventHandlers={{ click: () => handleMarkerClick(p.id) }}
        >
          <Tooltip direction="top" opacity={1}>
            <span>
              {p.name}
              <span style={{ opacity: 0.6 }}>, {countryName(p.country)}</span>
            </span>
          </Tooltip>
        </Marker>
      )),
    [points],
  )

  const activePoint = activeId ? points.find((p) => p.id === activeId) : null

  return (
    <MapContainer
      center={WORLD_CENTER}
      zoom={2}
      minZoom={minZoom}
      worldCopyJump
      zoomControl={false}
      className="h-full w-full"
      // Telephone : les contours des pays en canvas (un seul calque) plutot
      // qu'en centaines de chemins SVG, et une glisse plus longue et douce.
      preferCanvas={TOUCH}
      inertiaDeceleration={TOUCH ? 2200 : 3000}
      inertiaMaxSpeed={TOUCH ? 2400 : 1500}
      easeLinearity={0.22}
      zoomSnap={TOUCH ? 0.25 : 1}
      wheelPxPerZoomLevel={90}
    >
      <TileLayer
        key={theme}
        url={tileUrl}
        maxZoom={19}
        // Garde plus de tuiles autour de l'ecran : pas de trous gris quand
        // on glisse vite, et pas de rechargement pendant l'animation de zoom.
        keepBuffer={TOUCH ? 6 : 3}
        updateWhenZooming={false}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />

      <ZoomControl position="bottomright" />

      <MapHandle onReady={(map) => (mapRef.current = map)} />

      {onMapClick && <ClickCatcher enabled={picking} onClick={onMapClick} />}
      {autoFit && (
        <FitOnce
          key={fitTo && fitTo.length > 0 ? `zone-${fitTo.length}` : 'tout'}
          points={fitTo && fitTo.length > 0 ? fitTo : points}
        />
      )}
      <FlyTo target={focus ?? null} />

      {/* Halo du lieu selectionne, pose hors grappe pour ne jamais toucher
          aux marqueurs eux-memes. */}
      {activePoint && (
        <Marker
          position={[activePoint.lat, activePoint.lng]}
          icon={haloIcon}
          interactive={false}
          zIndexOffset={-500}
        />
      )}

      {cluster ? (
        <MarkerClusterGroup
          chunkedLoading
          maxClusterRadius={48}
          showCoverageOnHover={false}
          // On gere nous-memes le clic : eparpiller les marqueurs ou zoomer
          // indefiniment ne repond pas a la question « lequel ? »
          zoomToBoundsOnClick={false}
          spiderfyOnMaxZoom={false}
          // La bibliotheque prefixe elle-meme l'evenement : onClick devient
          // clusterclick. Nommer la prop onClusterClick donnerait
          // clusterclusterclick, qui n'existe pas et ne se declenche jamais.
          onClick={handleClusterClick}
          iconCreateFunction={(c: { getChildCount: () => number }) => clusterIcon(c.getChildCount())}
        >
          {markers}
        </MarkerClusterGroup>
      ) : (
        markers
      )}

      {tracks.map((track) =>
        track.points.length > 1 ? (
          <Polyline
            key={track.id}
            positions={track.points.map((p) => [p.lat, p.lng] as [number, number])}
            pathOptions={{ color: 'var(--accent)', weight: 3.5, opacity: 0.85 }}
            eventHandlers={onTrackSelect ? { click: () => onTrackSelect(track.id) } : undefined}
          >
            <Tooltip sticky>
              <span>{track.name}</span>
            </Tooltip>
          </Polyline>
        ) : null,
      )}

      {liveTrack && liveTrack.length > 1 && (
        <Polyline
          positions={liveTrack.map((p) => [p.lat, p.lng] as [number, number])}
          pathOptions={{ color: 'var(--accent)', weight: 4, opacity: 0.95, dashArray: '2 8' }}
        />
      )}

      {draft && <Marker position={[draft.lat, draft.lng]} icon={draftIcon} />}
      {children}
    </MapContainer>
  )
}

const MapCanvas = memo(MapCanvasInner)
export default MapCanvas

/** Expose l'instance Leaflet au composant parent. */
/** Ecran tactile : on allege les effets couteux pendant les gestes. */
const TOUCH = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

function MapHandle({ onReady }: { onReady: (map: L.Map) => void }) {
  const map = useMap()
  useEffect(() => {
    // Pendant un deplacement, les lueurs et flous sont coupes (classe CSS)
    const root = document.documentElement
    root.classList.add('has-map')
    const start = () => root.classList.add('map-moving')
    const end = () => root.classList.remove('map-moving')
    map.on('movestart zoomstart', start)
    map.on('moveend zoomend', end)
    return () => {
      map.off('movestart zoomstart', start)
      map.off('moveend zoomend', end)
      root.classList.remove('has-map', 'map-moving')
    }
  }, [map])
  useEffect(() => {
    onReady(map)
    // Poignee de mise au point, uniquement en developpement : elle permet de
    // piloter la carte depuis la console pour reproduire un cas precis.
    if (import.meta.env.DEV) {
      ;(window as unknown as { __bubuMap?: L.Map }).__bubuMap = map
    }
  }, [map, onReady])
  return null
}

function ClickCatcher({
  enabled,
  onClick,
}: {
  enabled: boolean
  onClick: (lat: number, lng: number) => void
}) {
  useMapEvents({
    click(e) {
      if (enabled) onClick(e.latlng.lat, e.latlng.wrap().lng)
    },
  })
  return null
}

/**
 * Cadre la carte sur les points une seule fois. Sans ce verrou, chaque ajout
 * de lieu recadrerait la vue et arracherait la carte sous le curseur.
 */
function FitOnce({ points }: { points: { lat: number; lng: number }[] }) {
  const map = useMap()
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (done || points.length === 0) return
    // Sans animation : un second cadrage (zone du voyage) arrive souvent
    // pendant celui-ci, et Leaflet ignore un zoom lance en pleine animation.
    if (points.length === 1) map.setView([points[0].lat, points[0].lng], 6, { animate: false })
    else {
      map.fitBounds(
        points.map((p) => [p.lat, p.lng] as [number, number]),
        { padding: [70, 70], maxZoom: 12, animate: false },
      )
    }
    setDone(true)
  }, [points, done, map])
  return null
}

function FlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap()
  // On compare les coordonnees, pas l'identite du tableau : un simple rendu
  // relançait sinon l'animation, et la carte paraissait se figer.
  const key = target ? `${target[0]},${target[1]}` : null
  const lastRef = useRef<string | null>(null)

  useEffect(() => {
    if (!target || !key || lastRef.current === key) return
    lastRef.current = key
    map.flyTo(target, Math.max(map.getZoom(), 7), { duration: 0.9 })
  }, [key, target, map])

  return null
}
