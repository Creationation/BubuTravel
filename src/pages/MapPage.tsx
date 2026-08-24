import { useCallback, useEffect, useMemo, useState } from 'react'
import { MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { Link } from 'react-router-dom'
import { usePlaces } from '../context/PlacesContext'
import { reverseGeocode } from '../lib/geocode'
import type { Place } from '../lib/types'
import { activeIcon, draftIcon, placeIcon } from '../components/mapIcon'
import PlaceSidebar from '../components/PlaceSidebar'
import PlaceForm, { emptyDraft } from '../components/PlaceForm'
import type { Draft } from '../components/PlaceForm'

const WORLD_CENTER: [number, number] = [30, 10]

type Panel = { kind: 'none' } | { kind: 'place'; id: string } | { kind: 'new' }

export default function MapPage() {
  const { places, loading } = usePlaces()
  const [panel, setPanel] = useState<Panel>({ kind: 'none' })
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [picking, setPicking] = useState(false)
  const [focus, setFocus] = useState<[number, number] | null>(null)

  const selected = useMemo(
    () => (panel.kind === 'place' ? (places.find((p) => p.id === panel.id) ?? null) : null),
    [panel, places],
  )

  // Un lieu supprime ne doit pas laisser un panneau vide ouvert
  useEffect(() => {
    if (panel.kind === 'place' && !selected) setPanel({ kind: 'none' })
  }, [panel, selected])

  const onMapClick = useCallback(
    async (lat: number, lng: number) => {
      if (!picking) return
      setPicking(false)
      setDraft((prev) => ({ ...prev, lat, lng }))
      const found = await reverseGeocode(lat, lng)
      if (found) {
        setDraft((prev) => ({
          ...prev,
          lat,
          lng,
          name: prev.name || found.name,
          country: prev.country || found.country,
        }))
      }
    },
    [picking],
  )

  function openNew() {
    setDraft(emptyDraft)
    setPanel({ kind: 'new' })
    setPicking(true)
  }

  function closePanel() {
    setPanel({ kind: 'none' })
    setPicking(false)
  }

  function selectPlace(place: Place) {
    setPicking(false)
    setPanel({ kind: 'place', id: place.id })
    setFocus([place.lat, place.lng])
  }

  const bounds = useMemo<[number, number][] | null>(
    () => (places.length === 0 ? null : places.map((p) => [p.lat, p.lng] as [number, number])),
    [places],
  )

  const count = places.length

  return (
    <div className="flex h-full flex-col">
      <header className="rule flex shrink-0 flex-wrap items-center justify-between gap-3 bg-paper px-4 py-3 sm:px-5">
        <div className="flex items-center gap-3">
          <Link to="/" className="btn btn-sm">
            Retour
          </Link>
          <div>
            <h1 className="font-display text-2xl leading-none">Carte des voyages</h1>
            <p className="mt-1 text-[11px] font-medium uppercase tracking-widest text-muted">
              {loading
                ? 'Chargement...'
                : `${count} lieu${count > 1 ? 'x' : ''} enregistre${count > 1 ? 's' : ''}`}
            </p>
          </div>
        </div>
        <button onClick={openNew} className="btn btn-primary">
          Ajouter un lieu
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className={`relative min-h-0 min-w-0 flex-1 ${picking ? 'cursor-crosshair' : ''}`}>
          <MapContainer
            center={WORLD_CENTER}
            zoom={2}
            minZoom={2}
            worldCopyJump
            className="h-full w-full"
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            />

            <ClickCatcher onClick={onMapClick} enabled={picking} />
            <FitOnce bounds={bounds} />
            <FlyTo target={focus} />

            {places.map((place) => (
              <Marker
                key={place.id}
                position={[place.lat, place.lng]}
                icon={selected?.id === place.id ? activeIcon : placeIcon}
                eventHandlers={{ click: () => selectPlace(place) }}
              >
                <Tooltip direction="top" offset={[0, -36]} opacity={1}>
                  <span className="text-xs">
                    {place.name}, {place.country}
                  </span>
                </Tooltip>
              </Marker>
            ))}

            {panel.kind === 'new' && draft.lat !== null && draft.lng !== null && (
              <Marker position={[draft.lat, draft.lng]} icon={draftIcon} />
            )}
          </MapContainer>

          {picking && (
            <div className="pointer-events-none absolute left-1/2 top-4 z-[1000] -translate-x-1/2">
              <span className="card-soft inline-block bg-yellow px-4 py-2 text-xs font-bold">
                Cliquez sur la carte pour poser le marqueur
              </span>
            </div>
          )}

          {!loading && count === 0 && panel.kind === 'none' && (
            <div className="pointer-events-none absolute inset-x-4 bottom-6 z-[1000] flex justify-center">
              <span className="card-soft bg-white px-5 py-3 text-center text-sm">
                Aucun lieu pour le moment. Commencez par
                <b> Ajouter un lieu</b>.
              </span>
            </div>
          )}
        </div>

        {panel.kind === 'place' && selected && (
          <PlaceSidebar place={selected} onClose={closePanel} />
        )}

        {panel.kind === 'new' && (
          <PlaceForm
            draft={draft}
            onDraftChange={setDraft}
            picking={picking}
            onTogglePicking={() => setPicking((v) => !v)}
            onSaved={(place) => selectPlace(place)}
            onCancel={closePanel}
          />
        )}
      </div>
    </div>
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

/** Cadre la carte sur les lieux au premier chargement, puis ne bouge plus. */
function FitOnce({ bounds }: { bounds: [number, number][] | null }) {
  const map = useMap()
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (done || !bounds || bounds.length === 0) return
    if (bounds.length === 1) map.setView(bounds[0], 6)
    else map.fitBounds(bounds, { padding: [60, 60], maxZoom: 8 })
    setDone(true)
  }, [bounds, done, map])
  return null
}

function FlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap()
  useEffect(() => {
    if (target) map.flyTo(target, Math.max(map.getZoom(), 6), { duration: 0.8 })
  }, [target, map])
  return null
}
