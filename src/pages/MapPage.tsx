import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { usePlaces } from '../context/PlacesContext'
import { useTracker } from '../context/TrackerContext'
import { reverseGeocode } from '../lib/geocode'
import { currentPosition } from '../lib/geolocation'
import type { Place } from '../lib/types'
import AppShell from '../components/AppShell'
import MapCanvas from '../components/MapCanvas'
import PlaceSidebar from '../components/PlaceSidebar'
import PlaceForm, { emptyDraft } from '../components/PlaceForm'
import type { Draft, GpsInfo } from '../components/PlaceForm'
import TrackRecorder from '../components/TrackRecorder'
import TrackSidebar from '../components/TrackSidebar'
import MapFilters, { applyFilter, emptyFilter } from '../components/MapFilters'
import type { MapFilter } from '../components/MapFilters'
import { errorMessage } from '../lib/errors'

type Panel =
  | { kind: 'none' }
  | { kind: 'place'; id: string }
  | { kind: 'new' }
  | { kind: 'track'; id: string }

export default function MapPage() {
  const { places, tracks, loading, pushTrack } = usePlaces()
  const { recording } = useTracker()
  const [params, setParams] = useSearchParams()
  const [panel, setPanel] = useState<Panel>({ kind: 'none' })
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [gps, setGps] = useState<GpsInfo | null>(null)
  const [picking, setPicking] = useState(false)
  const [focus, setFocus] = useState<[number, number] | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [filter, setFilter] = useState<MapFilter>(emptyFilter)

  const selected = useMemo(
    () => (panel.kind === 'place' ? (places.find((p) => p.id === panel.id) ?? null) : null),
    [panel, places],
  )
  const selectedTrack = useMemo(
    () => (panel.kind === 'track' ? (tracks.find((t) => t.id === panel.id) ?? null) : null),
    [panel, tracks],
  )

  // Arrivee depuis la bucketlist : le formulaire s'ouvre en mode envie
  const wantWish = params.get('envie')
  useEffect(() => {
    if (!wantWish) return
    setDraft({ ...emptyDraft, status: 'wishlist' })
    setPanel({ kind: 'new' })
    setPicking(true)
    params.delete('envie')
    setParams(params, { replace: true })
  }, [wantWish, params, setParams])

  // Ouverture directe d'un lieu depuis la timeline du carnet
  const wanted = params.get('lieu')
  useEffect(() => {
    if (!wanted || places.length === 0) return
    const place = places.find((p) => p.id === wanted)
    if (place) {
      setPanel({ kind: 'place', id: place.id })
      setFocus([place.lat, place.lng])
    }
    params.delete('lieu')
    setParams(params, { replace: true })
  }, [wanted, places, params, setParams])

  useEffect(() => {
    if (panel.kind === 'place' && !selected) setPanel({ kind: 'none' })
    if (panel.kind === 'track' && !selectedTrack) setPanel({ kind: 'none' })
  }, [panel, selected, selectedTrack])

  const onMapClick = useCallback(async (lat: number, lng: number) => {
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
        city: prev.city || found.city,
      }))
    }
  }, [])

  function openNew() {
    setDraft(emptyDraft)
    setGps(null)
    setPanel({ kind: 'new' })
    setPicking(true)
  }

  /**
   * Releve sur place : position du navigateur, geocodage inverse, puis
   * formulaire pre-rempli avec une demande de confirmation de l'adresse.
   * Le GPS d'un telephone se trompe souvent de plusieurs dizaines de metres
   * en ville, il ne faut jamais enregistrer sans faire valider.
   */
  async function scanHere() {
    setScanning(true)
    setScanError(null)
    try {
      const fix = await currentPosition()
      const found = await reverseGeocode(fix.lat, fix.lng)
      const today = new Date()
      const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
        today.getDate(),
      ).padStart(2, '0')}`

      setDraft({
        ...emptyDraft,
        lat: fix.lat,
        lng: fix.lng,
        name: found?.name ?? '',
        country: found?.country ?? '',
        city: found?.city ?? '',
        visit_date: iso,
      })
      setGps({
        accuracy: fix.accuracy,
        label: found?.label ?? `${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}`,
      })
      setPicking(false)
      setPanel({ kind: 'new' })
      setFocus([fix.lat, fix.lng])
    } catch (err) {
      setScanError(errorMessage(err))
    } finally {
      setScanning(false)
    }
  }

  function closePanel() {
    setPanel({ kind: 'none' })
    setPicking(false)
    setGps(null)
  }

  function selectPlace(place: Place) {
    setPicking(false)
    setGps(null)
    setPanel({ kind: 'place', id: place.id })
    setFocus([place.lat, place.lng])
  }

  const filtered = useMemo(() => applyFilter(places, filter), [places, filter])

  const points = useMemo(
    () =>
      filtered.map((p) => ({
        id: p.id,
        lat: p.lat,
        lng: p.lng,
        name: p.name,
        country: p.country,
        wish: p.status === 'wishlist',
      })),
    [filtered],
  )
  const trackLines = useMemo(
    () => tracks.map((t) => ({ id: t.id, name: t.name, points: t.points })),
    [tracks],
  )

  return (
    <AppShell wide>
      <div className="flex h-[calc(100vh-4rem)] flex-col">
        <div className="relative flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3 sm:px-8">
          <div className="min-w-0">
            <p className="eyebrow mb-1.5">Carte</p>
            {loading ? (
              <p className="text-[13px] text-text-soft">Chargement du carnet...</p>
            ) : (
              <MapFilters
                value={filter}
                onChange={setFilter}
                shown={filtered.length}
                total={places.length}
              />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => void scanHere()} className="btn" disabled={scanning}>
              {scanning ? 'Reperage...' : 'Je suis ici'}
            </button>
            <button
              onClick={() => {
                setDraft({ ...emptyDraft, status: 'wishlist' })
                setGps(null)
                setPanel({ kind: 'new' })
                setPicking(true)
              }}
              className="btn"
            >
              Ajouter une envie
            </button>
            <button onClick={openNew} className="btn btn-accent">
              Ajouter un lieu
            </button>
          </div>
        </div>

        {scanError && (
          <p className="notice notice-bad mx-5 mt-3 sm:mx-8">{scanError}</p>
        )}

        <div className="relative flex min-h-0 flex-1 flex-col md:flex-row">
          <div className={`relative min-h-0 flex-1 ${picking ? 'cursor-crosshair' : ''}`}>
            <MapCanvas
              points={points}
              tracks={trackLines}
              liveTrack={recording?.points ?? null}
              onTrackSelect={(id) => {
                setPicking(false)
                setPanel({ kind: 'track', id })
              }}
              activeId={selected?.id ?? null}
              onSelect={(id) => {
                const place = places.find((p) => p.id === id)
                if (place) selectPlace(place)
              }}
              draft={
                panel.kind === 'new' && draft.lat !== null && draft.lng !== null
                  ? { lat: draft.lat, lng: draft.lng }
                  : null
              }
              picking={picking}
              onMapClick={picking ? onMapClick : undefined}
              focus={focus}
            />

            {/* Enregistreur de parcours, toujours accessible */}
            <div className="absolute bottom-6 left-5 z-[1000]">
              <TrackRecorder
                onSaved={(track) => {
                  pushTrack(track)
                  setPanel({ kind: 'track', id: track.id })
                }}
              />
            </div>

            {picking && (
              <div className="pointer-events-none absolute inset-x-0 top-5 z-[1000] flex justify-center px-4">
                <span className="fade-in panel px-4 py-2 text-[13px] text-text-soft shadow-lg">
                  Cliquez sur la carte pour poser le marqueur
                </span>
              </div>
            )}

            {!loading && places.length === 0 && panel.kind === 'none' && (
              <div className="pointer-events-none absolute inset-x-0 bottom-24 z-[1000] flex justify-center px-4 md:bottom-8 md:pl-64">
                <span className="fade-in panel px-5 py-3 text-center text-[13px] text-text-soft shadow-lg">
                  Aucun lieu pour le moment. « Je suis ici » releve votre position, « Ajouter un
                  lieu » vous laisse choisir.
                </span>
              </div>
            )}
          </div>

          {panel.kind === 'place' && selected && (
            <PlaceSidebar key={selected.id} place={selected} onClose={closePanel} />
          )}

          {panel.kind === 'track' && selectedTrack && (
            <TrackSidebar key={selectedTrack.id} track={selectedTrack} onClose={closePanel} />
          )}

          {panel.kind === 'new' && (
            <PlaceForm
              draft={draft}
              onDraftChange={setDraft}
              picking={picking}
              onTogglePicking={() => setPicking((v) => !v)}
              onSaved={(place) => selectPlace(place)}
              onCancel={closePanel}
              gps={gps}
            />
          )}
        </div>
      </div>
    </AppShell>
  )
}
