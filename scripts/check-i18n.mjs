/**
 * Detecte les textes francais restes en dur dans l'interface.
 *
 * L'app doit s'afficher entierement dans une seule langue : une chaine
 * oubliee produit un ecran mi-francais mi-anglais, exactement ce qu'on veut
 * eviter. Ce script est volontairement bete et bruyant, il vaut mieux un faux
 * positif qu'un texte qui passe entre les mailles.
 *
 * Lancer avec : node scripts/check-i18n.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = 'src'
const SKIP_DIRS = ['i18n']

/** Mots frequents en francais, absents de l'anglais courant. */
const FRENCH = [
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'au', 'aux', 'ce', 'cet', 'cette',
  'vous', 'votre', 'vos', 'nous', 'notre', 'nos', 'est', 'sont', 'etre', 'avoir',
  'pas', 'plus', 'tout', 'tous', 'toute', 'toutes', 'avec', 'sans', 'pour', 'dans',
  'sur', 'par', 'aucun', 'aucune', 'depuis', 'jusqu', 'ou', 'donc', 'lieu', 'lieux',
  'voyage', 'voyages', 'carte', 'photo', 'photos', 'enregistrer', 'supprimer',
  'modifier', 'ajouter', 'creer', 'annuler', 'fermer', 'chargement', 'aucune',
]

const files = []
;(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.includes(entry)) walk(path)
    } else if (entry.endsWith('.tsx')) {
      files.push(path)
    }
  }
})(ROOT)

let problems = 0

for (const file of files) {
  const source = readFileSync(file, 'utf8')
  const lines = source.split('\n')

  lines.forEach((line, i) => {
    const trimmed = line.trim()
    // On ignore les commentaires, les imports et les lignes deja traduites
    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('import ')
    ) {
      return
    }

    // Texte JSX : ce qui se trouve entre > et < sans accolade
    const nodes = [...line.matchAll(/>([^<>{}]{4,})</g)].map((m) => m[1])
    // Attributs de texte
    const attrs = [...line.matchAll(/(?:placeholder|title|aria-label)="([^"]{4,})"/g)].map(
      (m) => m[1],
    )

    for (const text of [...nodes, ...attrs]) {
      const words = text
        .toLowerCase()
        .replace(/[^a-z\s']/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
      if (words.length === 0) continue
      const french = words.filter((w) => FRENCH.includes(w))
      if (french.length > 0) {
        problems++
        console.log(`${file}:${i + 1}  ${text.trim().slice(0, 80)}`)
      }
    }
  })
}

if (problems === 0) {
  console.log('Aucun texte francais en dur dans les composants.')
} else {
  console.log(`\n${problems} texte(s) a traduire.`)
  process.exitCode = 1
}
