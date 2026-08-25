import { supabase } from './supabase'

export type PlannedActivity = {
  name: string
  city: string
  country: string
  address: string
  day: number
  moment: 'matin' | 'midi' | 'apres-midi' | 'soir'
  kind: string
  why: string
  duration_hours: number
  price_estimate: number
  currency: string
  booking: string
  lat: number
  lng: number
}

export type Plan = {
  summary: string
  total_estimate: number
  currency: string
  activities: PlannedActivity[]
}

export type PlanRequest = {
  destination: string
  days: number
  travellers: number
  interests: string[]
  budget: 'petit' | 'moyen' | 'confortable' | 'luxe'
  pace: 'tranquille' | 'equilibre' | 'dense'
  season: string
  notes: string
  lang: 'fr' | 'en'
}

export const MOMENTS: PlannedActivity['moment'][] = ['matin', 'midi', 'apres-midi', 'soir']

/**
 * Appelle la fonction serveur. Le jeton de session part dans l'en-tete :
 * l'endpoint le verifie avant d'appeler le modele, sinon n'importe qui
 * pourrait consommer le credit en appelant l'URL a la main.
 */
async function call(payload: Record<string, unknown>): Promise<Plan> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Connexion requise')

  const res = await fetch('/api/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    let message = `Le planificateur a repondu ${res.status}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // Reponse non JSON : on garde le message par defaut
    }
    throw new Error(message)
  }
  return (await res.json()) as Plan
}

export function requestPlan(input: PlanRequest): Promise<Plan> {
  return call({ ...input, mode: 'plan' })
}

export function replaceActivity(
  input: PlanRequest,
  current: PlannedActivity[],
  replaceIndex: number,
): Promise<Plan> {
  return call({ ...input, mode: 'replace', current, replaceIndex })
}

export function groupByDay(activities: PlannedActivity[]): { day: number; items: PlannedActivity[] }[] {
  const map = new Map<number, PlannedActivity[]>()
  for (const a of activities) {
    const list = map.get(a.day)
    if (list) list.push(a)
    else map.set(a.day, [a])
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, items]) => ({
      day,
      items: [...items].sort((x, y) => MOMENTS.indexOf(x.moment) - MOMENTS.indexOf(y.moment)),
    }))
}
