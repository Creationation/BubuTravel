import { useEffect, useState } from 'react'
import { CircleMarker, Tooltip } from 'react-leaflet'
import { usePlaces } from '../context/PlacesContext'
import { pickCurrentTrip } from '../lib/currentTrip'
import { fetchStops } from '../lib/tripApi'
import type { TrackPoint, TripStop } from '../lib/types'

/**
 * Le voyage du moment sur la carte principale : ses etapes (pastilles avec
 * le nom) et le trace qui les relie. Les choses a voir, elles, sont des lieux
 * « a visiter » ordinaires et s'affichent deja comme tels.
 */
export function useCurrentTripStops() {
  const { trips, places } = usePlaces()
  const trip = pickCurrentTrip(trips)
  const [stops, setStops] = useState<TripStop[]>([])

  useEffect(() => {
    if (!trip) return
    let active = true
    fetchStops(trip.id)
      .then((list) => active && setStops(list.filter((s) => s.lat != null && s.lng != null)))
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [trip?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const points =
    stops.length > 0
      ? [
          ...stops.map((s) => ({ lat: s.lat as number, lng: s.lng as number })),
          ...places.filter((p) => p.trip_id === trip?.id).map((p) => ({ lat: p.lat, lng: p.lng })),
        ]
      : []
  const line =
    stops.length > 1
      ? {
          id: 'trajet-voyage',
          name: trip?.title ?? '',
          points: stops.map((s, i): TrackPoint => ({ t: i, lat: s.lat as number, lng: s.lng as number })),
        }
      : null
  return { stops, points, line }
}

export default function TripStopsLayer({ stops }: { stops: TripStop[] }) {
  return (
    <>
      {stops.map((s, i) => (
        <CircleMarker
          key={s.id}
          center={[s.lat as number, s.lng as number]}
          radius={9}
          pathOptions={{ color: '#ffffff', weight: 2.5, fillColor: '#e2522c', fillOpacity: 1 }}
        >
          <Tooltip permanent direction="top" offset={[0, -8]} className="stop-label">
            {i + 1}. {s.name}
          </Tooltip>
        </CircleMarker>
      ))}
    </>
  )
}
