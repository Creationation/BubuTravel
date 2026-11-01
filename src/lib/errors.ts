import { tr } from '../i18n/current'

const ERROR_LOG_KEY = 'bubutravel:error-log'
const ERROR_LOG_EVENT = 'bubutravel:error-log-change'
const MAX_ERRORS = 50

export type AppErrorEntry = {
  id: string
  at: string
  message: string
  source: string
  details: string | null
}

export function readErrorLog(): AppErrorEntry[] {
  try {
    const value = JSON.parse(localStorage.getItem(ERROR_LOG_KEY) ?? '[]') as AppErrorEntry[]
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

export function recordAppError(error: unknown, source = 'app', details?: string | null): void {
  try {
    const entry: AppErrorEntry = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      message: errorMessage(error),
      source,
      details: details?.slice(0, 2000) || null,
    }
    localStorage.setItem(ERROR_LOG_KEY, JSON.stringify([entry, ...readErrorLog()].slice(0, MAX_ERRORS)))
    window.dispatchEvent(new Event(ERROR_LOG_EVENT))
  } catch {
    // Le journal ne doit jamais provoquer une nouvelle erreur.
  }
}

export function clearErrorLog(): void {
  try {
    localStorage.removeItem(ERROR_LOG_KEY)
    window.dispatchEvent(new Event(ERROR_LOG_EVENT))
  } catch {
    // Stockage indisponible : rien d'autre a faire.
  }
}

export function onErrorLogChange(listener: () => void): () => void {
  window.addEventListener(ERROR_LOG_EVENT, listener)
  window.addEventListener('storage', listener)
  return () => {
    window.removeEventListener(ERROR_LOG_EVENT, listener)
    window.removeEventListener('storage', listener)
  }
}
/**
 * Les erreurs de supabase-js ne sont pas des instances d'Error : ce sont des
 * objets { message, code, details, hint }. Un String(err) dessus affiche
 * "[object Object]" a l'ecran, d'ou ce passage oblige.
 */
export function errorMessage(err: unknown): string {
  if (!err) return tr('error.unknown')
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message

  if (typeof err === 'object') {
    const e = err as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown }
    const parts = [e.message, e.details, e.hint].filter(
      (p): p is string => typeof p === 'string' && p.length > 0,
    )
    if (parts.length > 0) return parts.join(' ')
    if (typeof e.code === 'string') return tr('error.code', { code: e.code })
  }
  return tr('error.unknown')
}

const MISSING_TABLE = /does not exist|schema cache|Could not find the (table|function)/i

/** Vrai quand une migration n'a pas encore ete executee cote Supabase. */
export function isMissingTable(err: unknown): boolean {
  return MISSING_TABLE.test(errorMessage(err))
}
