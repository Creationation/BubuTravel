import imageCompression from 'browser-image-compression'

/**
 * Compression avant envoi. Une photo de telephone pese couramment 4 a 12 Mo :
 * envoyer l'original sature le stockage et rend l'ajout interminable en 4G.
 * On vise le cote long a 2200 px, ce qui reste net en plein ecran.
 *
 * preserveExif est indispensable ici : l'app lit la date de prise de vue et
 * la position GPS dans les metadonnees, les perdre casserait le pre-remplissage
 * et l'orientation de l'image.
 */
const OPTIONS = {
  maxSizeMB: 1.6,
  maxWidthOrHeight: 2200,
  useWebWorker: true,
  preserveExif: true,
  initialQuality: 0.82,
}

/** Au-dela, la compression apporte peu et coute du temps. */
const SKIP_UNDER_BYTES = 600 * 1024

export type Compressed = {
  file: File
  originalBytes: number
  bytes: number
}

export async function compressImage(file: File): Promise<Compressed> {
  const originalBytes = file.size

  // Un format non bitmap, ou une image deja legere, part telle quelle
  if (!file.type.startsWith('image/') || file.type === 'image/gif') {
    return { file, originalBytes, bytes: originalBytes }
  }
  if (originalBytes <= SKIP_UNDER_BYTES) {
    return { file, originalBytes, bytes: originalBytes }
  }

  try {
    const out = await imageCompression(file, OPTIONS)
    // La compression peut grossir un fichier deja optimise : on garde le plus petit
    if (out.size >= originalBytes) return { file, originalBytes, bytes: originalBytes }
    const named = new File([out], file.name, { type: out.type, lastModified: file.lastModified })
    return { file: named, originalBytes, bytes: named.size }
  } catch {
    // Un echec de compression ne doit jamais empecher d'enregistrer la photo
    return { file, originalBytes, bytes: originalBytes }
  }
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`
  return `${Math.round(bytes / 1024)} ko`
}
