/**
 * Genere l'icone source de l'app native et l'ecran de lancement, a partir du
 * meme dessin que les icones PWA. Lance avec : node scripts/make-app-assets.mjs
 * Puis : npx capacitor-assets generate --android
 */
import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'

const OUT = 'resources'
await mkdir(OUT, { recursive: true })

/** Marqueur en arche sur fond terre brulee, aux couleurs du theme. */
function icon(size, padding, background) {
  const inner = size - padding * 2
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" fill="${background}"/>
  <g transform="translate(${padding} ${padding}) scale(${inner / 512})">
    <path d="M256 74c-79 0-143 64-143 143 0 104 122 244 128 250a20 20 0 0 0 30 0c6-6 128-146 128-250 0-79-64-143-143-143z" fill="#c0653f"/>
    <circle cx="256" cy="211" r="52" fill="#f6efe3"/>
  </g>
</svg>`)
}

/** Ecran de lancement : le marqueur au centre, tres large marge. */
function splash(width, height) {
  const size = Math.min(width, height)
  const art = Math.round(size * 0.22)
  const x = Math.round((width - art) / 2)
  const y = Math.round((height - art) / 2)
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" fill="#17120e"/>
  <g transform="translate(${x} ${y}) scale(${art / 512})">
    <path d="M256 74c-79 0-143 64-143 143 0 104 122 244 128 250a20 20 0 0 0 30 0c6-6 128-146 128-250 0-79-64-143-143-143z" fill="#c0653f"/>
    <circle cx="256" cy="211" r="52" fill="#f6efe3"/>
  </g>
</svg>`)
}

// icon.png : le dessin occupe presque toute la surface
await sharp(icon(1024, 48, '#17120e')).png().toFile(`${OUT}/icon.png`)
// icon-foreground : Android rogne jusqu'a 20 % sur chaque bord, d'ou la marge
await sharp(icon(1024, 240, '#00000000')).png().toFile(`${OUT}/icon-foreground.png`)
await sharp({
  create: { width: 1024, height: 1024, channels: 4, background: '#17120e' },
})
  .png()
  .toFile(`${OUT}/icon-background.png`)

await sharp(splash(2732, 2732)).png().toFile(`${OUT}/splash.png`)
await sharp(splash(2732, 2732)).png().toFile(`${OUT}/splash-dark.png`)

console.log('Ressources generees dans', OUT)
