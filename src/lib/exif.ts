import exifr from 'exifr'

export type PhotoMeta = {
  takenAt: string | null // AAAA-MM-JJ
  lat: number | null
  lng: number | null
}

/** Date lisible dans le nom du fichier : IMG_20260824, PXL_20260824, 2026-08-24... */
function dateFromName(name: string): string | null {
  const compact = name.match(/(20\d{2})(\d{2})(\d{2})/)
  if (compact) {
    const [, y, m, d] = compact
    if (Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31) {
      return `${y}-${m}-${d}`
    }
  }
  const dashed = name.match(/(20\d{2})[-_.](\d{2})[-_.](\d{2})/)
  if (dashed) {
    const [, y, m, d] = dashed
    if (Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31) {
      return `${y}-${m}-${d}`
    }
  }
  return null
}

/**
 * exifr construit ses Date en heure locale, donc on lit les composantes
 * locales. Appliquer un decalage ici ferait changer l'heure de pendule et
 * pourrait faire basculer la photo d'un jour a l'autre.
 */
function toIsoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * Lit date de prise de vue et position GPS dans les metadonnees d'une image.
 * Ordre de resolution de la date : EXIF, puis le nom du fichier, puis la date
 * de modification du fichier en dernier recours. Sans ce repli sur le nom, une
 * photo sans EXIF tombe sur l'instant de la copie, qui n'a aucun rapport avec
 * le voyage.
 */
export async function readPhotoMeta(file: File): Promise<PhotoMeta> {
  let takenAt: string | null = null
  let lat: number | null = null
  let lng: number | null = null

  try {
    const data = await exifr.parse(file, {
      pick: ['DateTimeOriginal', 'CreateDate', 'DateTimeDigitized', 'ModifyDate'],
      gps: true,
    })
    if (data) {
      const raw =
        data.DateTimeOriginal ?? data.CreateDate ?? data.DateTimeDigitized ?? data.ModifyDate
      if (raw instanceof Date && !Number.isNaN(raw.getTime())) takenAt = toIsoDay(raw)
      if (typeof data.latitude === 'number' && typeof data.longitude === 'number') {
        lat = data.latitude
        lng = data.longitude
      }
    }
  } catch {
    // Une image sans EXIF ou dans un format non lu n'est pas une erreur
  }

  if (!takenAt) takenAt = dateFromName(file.name)
  if (!takenAt && file.lastModified) takenAt = toIsoDay(new Date(file.lastModified))

  return { takenAt, lat, lng }
}
