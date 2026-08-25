import type { Category, Photo, Place, Track, Trip } from './types'

/** Declenche un telechargement depuis des donnees deja en memoire. */
function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Sans revoke, le blob reste en memoire tant que l'onglet vit
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export type Backup = {
  app: 'BuBuTravel'
  version: 1
  exported_at: string
  places: Place[]
  trips: Trip[]
  tracks: Track[]
  categories: Category[]
  /** Chemins de stockage, pas les images : les fichiers ne sont pas inclus. */
  photos: Photo[]
}

/**
 * Sauvegarde complete des donnees, hors fichiers images. Les photos sont
 * listees par leur chemin de stockage : le JSON reste leger et lisible,
 * et les images restent la ou elles sont.
 */
export function exportBackup(data: Omit<Backup, 'app' | 'version' | 'exported_at'>) {
  const backup: Backup = {
    app: 'BuBuTravel',
    version: 1,
    exported_at: new Date().toISOString(),
    ...data,
  }
  download(`bubutravel-${stamp()}.json`, JSON.stringify(backup, null, 2), 'application/json')
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Un parcours au format GPX 1.1, lisible par Garmin, Strava, Komoot et les
 * applications de randonnee. Les points portent leur horodatage, ce qui
 * permet de recalculer la vitesse a l'import.
 */
export function exportTrackGpx(track: Track) {
  const points = track.points
    .map(
      (p) =>
        `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}"><time>${new Date(
          p.t,
        ).toISOString()}</time></trkpt>`,
    )
    .join('\n')

  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="BuBuTravel" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(track.name)}</name>
    ${track.started_at ? `<time>${new Date(track.started_at).toISOString()}</time>` : ''}
  </metadata>
  <trk>
    <name>${escapeXml(track.name)}</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>
`
  const safe = track.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase() || 'parcours'
  download(`${safe}-${stamp()}.gpx`, gpx, 'application/gpx+xml')
}

/** Les lieux en CSV, pour une reprise dans un tableur. */
export function exportPlacesCsv(places: Place[], categories: Category[], trips: Trip[]) {
  const catById = new Map(categories.map((c) => [c.id, c.name]))
  const tripById = new Map(trips.map((t) => [t.id, t.title]))
  const head = ['nom', 'ville', 'pays', 'latitude', 'longitude', 'date', 'statut', 'categorie', 'voyage', 'notes']

  const cell = (value: string | number | null) => {
    const text = value === null ? '' : String(value)
    // Les points-virgules et les retours a la ligne cassent un CSV non echappe
    return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }

  const rows = places.map((p) =>
    [
      p.name,
      p.city ?? '',
      p.country,
      p.lat.toFixed(6),
      p.lng.toFixed(6),
      p.visit_date ?? '',
      p.status === 'wishlist' ? 'a visiter' : 'visite',
      p.category_id ? (catById.get(p.category_id) ?? '') : '',
      p.trip_id ? (tripById.get(p.trip_id) ?? '') : '',
      p.notes ?? '',
    ]
      .map(cell)
      .join(';'),
  )

  // Le BOM evite les accents casses a l'ouverture dans Excel
  download(`bubutravel-lieux-${stamp()}.csv`, `﻿${[head.join(';'), ...rows].join('\n')}`, 'text/csv')
}
