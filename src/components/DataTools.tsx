import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { usePlaces } from '../context/PlacesContext'
import { fetchAllPhotos } from '../lib/api'
import { exportBackup, exportPlacesCsv, exportTrackGpx } from '../lib/export'
import { errorMessage } from '../lib/errors'
import type { Photo } from '../lib/types'
import { useT } from '../i18n/I18nContext'

/** Sauvegarde et exports : rien ne doit rester prisonnier de l'app. */
export default function DataTools() {
  const t = useT()
  const { user } = useAuth()
  const { places, trips, tracks, categories } = usePlaces()
  const [photos, setPhotos] = useState<Photo[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    fetchAllPhotos(user.id)
      .then(setPhotos)
      .catch(() => {
        // L'export reste possible sans la liste des photos
      })
  }, [user])

  function run(action: () => void) {
    setBusy(true)
    setError(null)
    try {
      action()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => run(() => exportBackup({ places, trips, tracks, categories, photos }))}
          className="btn btn-accent"
          disabled={busy}
        >{t('profile.backupFull')}</button>
        <button
          onClick={() => run(() => exportPlacesCsv(places, categories, trips))}
          className="btn"
          disabled={busy || places.length === 0}
        >{t('profile.backupCsv')}</button>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-text-muted">{t('profile.backupNote')}</p>

      {tracks.length > 0 && (
        <div className="mt-5">
          <p className="label">{t('profile.gpxLabel')}</p>
          <div className="flex flex-wrap gap-2">
            {tracks.map((track) => (
              <button
                key={track.id}
                onClick={() => run(() => exportTrackGpx(track))}
                className="pill"
                disabled={busy || track.points.length < 2}
                title={
                  track.points.length < 2 ? t('track.tooFewPoints') : t('track.downloadGpx')
                }
              >
                {track.name}
                <span className="text-text-muted">
                  {track.distance_km.toFixed(1).replace('.', ',')} km
                </span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-text-muted">{t('profile.gpxHint')}</p>
        </div>
      )}

      {error && <p className="notice notice-bad mt-4">{error}</p>}
    </div>
  )
}
