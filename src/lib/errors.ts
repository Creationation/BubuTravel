/**
 * Les erreurs de supabase-js ne sont pas des instances d'Error : ce sont des
 * objets { message, code, details, hint }. Un String(err) dessus affiche
 * "[object Object]" a l'ecran, d'ou ce passage oblige.
 */
export function errorMessage(err: unknown): string {
  if (!err) return 'Erreur inconnue.'
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message

  if (typeof err === 'object') {
    const e = err as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown }
    const parts = [e.message, e.details, e.hint].filter(
      (p): p is string => typeof p === 'string' && p.length > 0,
    )
    if (parts.length > 0) return parts.join(' ')
    if (typeof e.code === 'string') return `Erreur ${e.code}`
  }
  return 'Erreur inconnue.'
}

const MISSING_TABLE = /does not exist|schema cache|Could not find the (table|function)/i

/** Message clair quand la migration 002 n'a pas encore ete executee. */
export function friendlyError(err: unknown): string {
  const raw = errorMessage(err)
  if (MISSING_TABLE.test(raw)) {
    return "Une table ou une fonction manque cote Supabase. Executez supabase/migrations/002_trips_gallery_sharing.sql dans le SQL Editor."
  }
  return raw
}
