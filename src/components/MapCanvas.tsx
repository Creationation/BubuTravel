import { useEffect, useState } from 'react'
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
import { activeIcon, clusterIcon, draftIcon, placeIcon } from './mapIcon'
import type { TrackPoint } from '../lib/types'

type Point = { id: string; lat: number; lng: number; name: string; country: string }
type TrackLine = { id: string; name: string; points: TrackPoint[] }

type Props = {
  points: Point[]
  activeId?: string | null
  onSelect?: (id: string) => void
  draft?: { lat: number; lng: number } | null
  picking?: boolean
  onMapClick?: (lat: number, lng: number) => void
  focus?: [number, number] | null
  /** Cadre la vue sur les points au premier rendu utile. */
  autoFit?: boolean
  cluster?: boolean
  minZoom?: number
  /** Parcours enregistres, traces en continu. */
  tracks?: TrackLine[]
  /** Parcours en cours d'enregistrement, trace en pointilles. */
  liveTrack?: TrackPoint[] | null
  onTrackSelect?: (id: string) => void
  children?: ReactNode
}

const WORLD_CENTER: [number, number] = [28, 8]

/**
 * Fond de carte CARTO : deux styles cohérents avec les deux themes, libres
 * d'usage et sans cle API, contrairement a Mapbox. La couche est remontee
 * avec une cle qui change avec le theme pour forcer le rechargement des
 * tuiles, sinon Leaflet garde l'ancien jeu en cache.
 */
export default function MapCanvas({
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

  const markers = points.map((p) => (
    <Marker
      key={p.id}
      position={[p.lat, p.lng]}
      icon={activeId === p.id ? activeIcon : placeIcon}
      eventHandlers={onSelect ? { click: () => onSelect(p.id) } : undefined}
    >
      <Tooltip direction="top" offset={[0, -14]} opacity={1}>
        <span>
          {p.name}
          <span style={{ opacity: 0.6 }}>, {p.country}</span>
        </span>
      </Tooltip>
    </Marker>
  ))

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
  useEffect(() => {
    if (target) map.flyTo(target, Math.max(map.getZoom(), 7), { duration: 0.9 })
  }, [target, map])
  return null
}
