/**
 * Assemble supabase/schema_complet.sql a partir de la base et de chaque
 * migration, dans l'ordre.
 *
 * Pourquoi : demander d'executer six fichiers dans le bon ordre, c'est
 * garantir qu'un jour l'un d'eux sautera, et l'app tombera sur une colonne
 * manquante sans que personne comprenne pourquoi. Un seul fichier, entierement
 * idempotent, supprime le probleme.
 *
 * Lancer avec : node scripts/build-schema.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'supabase/schema.sql'
const MIGRATIONS_DIR = 'supabase/migrations'
const OUT = 'supabase/schema_complet.sql'

// L'ordre des migrations est celui de leur numero, pas celui du disque
const migrations = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()

const header = `-- ============================================================================
-- BuBuTravel  |  SCHEMA COMPLET
--
-- Ce fichier contient TOUT : la base et chaque migration, dans l'ordre.
-- Il est entierement idempotent, il peut etre execute autant de fois qu'on
-- veut, sur une base vierge comme sur une base deja a jour. C'est le seul
-- fichier a coller dans Supabase > SQL Editor > New query > Run.
--
-- Genere par scripts/build-schema.mjs, ne pas modifier a la main :
-- editez supabase/schema.sql ou une migration, puis relancez le script.
-- ============================================================================

`

const chunks = [header]

function append(path, label) {
  chunks.push(
    '\n\n-- ####################################################################\n',
    `-- ## ${label}\n`,
    `-- ## source : ${path}\n`,
    '-- ####################################################################\n\n',
    readFileSync(path, 'utf8'),
  )
}

append(BASE, 'Base : profils, lieux, photos, RLS, buckets, trigger')
for (const file of migrations) {
  append(join(MIGRATIONS_DIR, file), `Migration ${file.replace(/\.sql$/, '')}`)
}

writeFileSync(OUT, chunks.join(''))
console.log(`${OUT} genere depuis ${migrations.length + 1} fichiers`)
