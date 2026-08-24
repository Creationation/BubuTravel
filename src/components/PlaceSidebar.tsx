import { useEffect, useState } from 'react'
import { deletePhoto, fetchPhotos, signPhotoUrls, uploadPhoto } from '../lib/api'
import type { Photo, Place } from '../lib/types'
import { usePlaces } from '../context/PlacesContext'
import { useAuth } from '../context/AuthContext'

type Props = {
  place: Place
  onClose: () => void
}

export default function PlaceSidebar({ place, onClose }: Props) {
  const { user } = useAuth()
  const { remove } = usePlaces()
  const [photos, setPhotos] = useState<Photo[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [zoomed, setZoomed] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    setPhotos([])
    setUrls({})
    setConfirmDelete(false)

    fetchPhotos(place.id)
      .then(async (list) => {
        if (!active) return
        setPhotos(list)
        const signed = await signPhotoUrls(list.map((p) => p.url))
        if (active) setUrls(signed)
      })
      .catch((err) => active && setError(err instanceof Error ? err.message : String(err)))
      .finally(() => active && setLoading(false))

    return () => {
      active = false
    }
  }, [place.id])

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0 || !user) return
    setBusy(true)
    setError(null)
    try {
      const added: Photo[] = []
      for (const file of Array.from(files)) {
        added.push(await uploadPhoto(user.id, place.id, file))
      }
      const signed = await signPhotoUrls(added.map((p) => p.url))
      setPhotos((prev) => [...prev, ...added])
      setUrls((prev) => ({ ...prev, ...signed }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function onDeletePhoto(photo: Photo) {
    setBusy(true)
    try {
      await deletePhoto(photo)
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function onDeletePlace() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setBusy(true)
    try {
      await remove(place)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <aside className="flex max-h-[55vh] w-full shrink-0 flex-col border-t-2 border-ink bg-paper md:max-h-none md:w-[24rem] md:border-l-2 md:border-t-0">
      <header className="rule flex items-start justify-between gap-3 bg-pink px-5 py-4">
        <div className="min-w-0">
          <h2 className="font-display truncate text-3xl leading-tight">{place.name}</h2>
          <p className="mt-1 text-xs font-bold uppercase tracking-widest">{place.country}</p>
          <p className="mt-2 text-[11px] font-medium">
            {place.visit_date ? formatDate(place.visit_date) : 'Date non renseignee'}
          </p>
          <p className="mt-0.5 font-mono text-[10px] opacity-70">
            {place.lat.toFixed(4)}, {place.lng.toFixed(4)}
          </p>
        </div>
        <button onClick={onClose} className="btn btn-icon shrink-0" aria-label="Fermer le panneau">
          ✕
        </button>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <section>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-widest">Notes</h3>
          <div className="card-soft p-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {place.notes?.trim() || <span className="text-muted">Aucune note pour ce lieu.</span>}
            </p>
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-widest">
              Photos {photos.length > 0 && `(${photos.length})`}
            </h3>
            <label className="btn btn-sm cursor-pointer">
              {busy ? 'Envoi...' : 'Ajouter'}
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                disabled={busy}
                onChange={(e) => {
                  void onFiles(e.target.files)
                  e.target.value = ''
                }}
              />
            </label>
          </div>

          {loading ? (
            <p className="text-xs text-muted">Chargement...</p>
          ) : photos.length === 0 ? (
            <p className="rounded-xl border-2 border-dashed border-ink/40 px-3 py-8 text-center text-xs text-muted">
              Pas encore de photo ici.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {photos.map((photo) => (
                <div
                  key={photo.id}
                  className="group relative aspect-square overflow-hidden rounded-lg border-2 border-ink bg-white"
                  style={{ boxShadow: '3px 3px 0 #000' }}
                >
                  {urls[photo.url] ? (
                    <img
                      src={urls[photo.url]}
                      alt=""
                      loading="lazy"
                      onClick={() => setZoomed(urls[photo.url])}
                      className="h-full w-full cursor-zoom-in object-cover"
                    />
                  ) : (
                    <div className="h-full w-full animate-pulse bg-paper-deep" />
                  )}
                  <button
                    onClick={() => void onDeletePhoto(photo)}
                    className="absolute right-1 top-1 hidden h-6 w-6 items-center justify-center rounded-full border-2 border-ink bg-orange text-[10px] font-bold group-hover:flex"
                    aria-label="Supprimer la photo"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {error && <p className="tag-alert">{error}</p>}
      </div>

      <footer className="border-t-2 border-ink px-5 py-4">
        <button
          onClick={() => void onDeletePlace()}
          disabled={busy}
          className={`btn btn-sm w-full ${confirmDelete ? 'bg-orange' : ''}`}
        >
          {confirmDelete ? 'Confirmer : supprimer le lieu et ses photos' : 'Supprimer ce lieu'}
        </button>
      </footer>

      {zoomed && (
        <div
          className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/85 p-6"
          onClick={() => setZoomed(null)}
        >
          <img
            src={zoomed}
            alt=""
            className="max-h-full max-w-full rounded-xl border-2 border-ink object-contain"
            style={{ boxShadow: '8px 8px 0 #000' }}
          />
        </div>
      )}
    </aside>
  )
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}
