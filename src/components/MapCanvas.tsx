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
import type { ReactNode } from 'react'
import { useTheme } from '../context/ThemeContext'
import { clusterIcon, draftIcon, haloIcon, placeIcon, wishIcon } from './mapIcon'
import type { TrackPoint } from '../lib/types'

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
}

const WORLD_CENTER: [number, number] = [28, 8]

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
}: Props) {
  const { theme } = useTheme()
  const tileUrl =
    theme === 'dark'
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'

  // Le gestionnaire passe par une reference : sa nouvelle identite a chaque
  // rendu suffirait sinon a faire remonter tous les marqueurs.
  const selectRef = useRef(onSelect)
  selectRef.current = onSelect

  const markers = useMemo(
    () =>
      points.map((p) => (
        <Marker
          key={p.id}
          position={[p.lat, p.lng]}
          icon={p.wish ? wishIcon : placeIcon}
          eventHandlers={{ click: () => selectRef.current?.(p.id) }}
        >
          <Tooltip direction="top" opacity={1}>
            <span>
              {p.name}
              <span style={{ opacity: 0.6 }}>, {p.country}</span>
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
    >
      <TileLayer
        key={theme}
        url={tileUrl}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
      />

      <ZoomControl position="bottomright" />

      {onMapClick && <ClickCatcher enabled={picking} onClick={onMapClick} />}
      {autoFit && <FitOnce points={points} />}
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
          spiderfyDistanceMultiplier={1.6}
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
    if (points.length === 1) map.setView([points[0].lat, points[0].lng], 6)
    else {
      map.fitBounds(
        points.map((p) => [p.lat, p.lng] as [number, number]),
        { padding: [70, 70], maxZoom: 8 },
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
