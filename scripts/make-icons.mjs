/**
 * Genere les icones PWA a partir d'un SVG unique.
 * Lance avec : node scripts/make-icons.mjs
 * Les PNG sont commites, le script ne tourne pas au build.
 */
import sharp from 'sharp'
import { mkdir, writeFile } from 'node:fs/promises'

const OUT = 'public/icons'

/** Marqueur en arche sur fond terre cuite, aux couleurs du theme. */
function svg({ padding }) {
  const s = 512
  const inner = s - padding * 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <rect width="${s}" height="${s}" fill="#17120e"/>
  <g transform="translate(${padding} ${padding}) scale(${inner / 512})">
    <path d="M256 74c-79 0-143 64-143 143 0 104 122 244 128 250a20 20 0 0 0 30 0c6-6 128-146 128-250 0-79-64-143-143-143z" fill="#c0653f"/>
    <circle cx="256" cy="211" r="52" fill="#f6efe3"/>
  </g>
</svg>`
}

await mkdir(OUT, { recursive: true })

// Icone classique : le dessin occupe presque toute la surface
const plain = Buffer.from(svg({ padding: 24 }))
// Icone maskable : Android rogne jusqu'a 20 % sur chaque bord, d'ou la marge
const maskable = Buffer.from(svg({ padding: 96 }))

await sharp(plain).resize(192, 192).png().toFile(`${OUT}/icon-192.png`)
await sharp(plain).resize(512, 512).png().toFile(`${OUT}/icon-512.png`)
await sharp(maskable).resize(512, 512).png().toFile(`${OUT}/maskable-512.png`)
await sharp(plain).resize(180, 180).png().toFile(`${OUT}/apple-touch-icon.png`)
await writeFile(`${OUT}/icon.svg`, svg({ padding: 24 }))

console.log('Icones generees dans', OUT)
