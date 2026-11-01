import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * Assistant d'itineraire pour un long voyage.
 *
 * Entree : la description brute du voyage (« Bangkok 4 jours, puis le nord,
 * Noel sur une ile, fin decembre le Vietnam... »), les dates et quelques
 * preferences. Sortie : des etapes datees, le trajet entre chacune, ce qu'il
 * faut reserver et avant quand, et les formalites.
 *
 * Cote serveur pour que la cle Anthropic n'atteigne jamais le navigateur, et
 * reserve aux comptes connectes (jeton Supabase verifie avant tout appel).
 */

const TransportSchema = z.object({
  mode: z.enum(['plane', 'train', 'bus', 'boat', 'car', 'taxi', 'motorbike', 'other']),
  details: z.string().describe('Ligne, compagnie ou trajet concret, ex. « Vol Bangkok DMK -> Chiang Mai, AirAsia ou Nok Air »'),
  duration_hours: z.number().describe('Duree porte a porte approximative'),
  price_estimate: z.number().describe('Prix indicatif par personne'),
  currency: z.string().describe('Code devise, EUR par defaut'),
  how_to_book: z.string().describe('Ou et comment reserver, ex. « 12Go.asia ou au comptoir de la gare »'),
  book_ahead_days: z.number().int().describe("Combien de jours a l'avance reserver, 0 si sur place"),
})

const StopSchema = z.object({
  name: z.string().describe('Ville ou region ou l on dort, nom usuel'),
  country: z.string().describe('Pays, dans la langue demandee'),
  lat: z.number(),
  lng: z.number(),
  arrive_date: z.string().describe('AAAA-MM-JJ'),
  leave_date: z.string().describe('AAAA-MM-JJ, jour du depart vers l etape suivante'),
  why: z.string().describe('Pourquoi cette etape et cette duree, deux phrases maximum'),
  highlights: z.array(z.string()).describe('3 a 6 choses a ne pas manquer, concretes et nommees'),
  stay_tip: z.string().describe('Quartier ou type d hebergement conseille, une phrase'),
  transport_to_next: TransportSchema.nullable().describe("Trajet vers l'etape suivante, null pour la derniere s'il n'y a pas de retour"),
})

const ItinerarySchema = z.object({
  summary: z.string().describe("Vue d'ensemble du voyage propose, trois phrases maximum"),
  stops: z.array(StopSchema),
  todos: z
    .array(
      z.object({
        title: z.string().describe('Action courte et precise, ex. « Reserver le ferry Koh Lanta -> Krabi »'),
        kind: z.enum(['todo', 'booking', 'admin', 'packing']),
        due_date: z.string().describe('AAAA-MM-JJ, date limite conseillee'),
        notes: z.string().describe('Precision utile, ou chaine vide'),
      }),
    )
    .describe('Reservations, formalites et preparatifs, dates comprises'),
  admin: z
    .array(z.object({ title: z.string(), detail: z.string() }))
    .describe('Visas, entree dans chaque pays, sante, argent, saison et meteo'),
})

const BodySchema = z.object({
  raw: z.string().min(10).max(4000),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  travellers: z.number().int().min(1).max(12).default(2),
  budget: z.enum(['petit', 'moyen', 'confortable', 'luxe']).default('moyen'),
  pace: z.enum(['tranquille', 'equilibre', 'dense']).default('equilibre'),
  nationality: z.string().max(60).default(''),
  lang: z.enum(['fr', 'en']).default('fr'),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  existing: z
    .array(z.object({ name: z.string(), arrive_date: z.string().nullable(), leave_date: z.string().nullable() }))
    .max(60)
    .default([]),
})

function systemPrompt(lang: 'fr' | 'en'): string {
  return `You are an experienced travel planner for long, independent trips, with deep practical
knowledge of Southeast Asia and beyond. You turn a traveller's rough notes into a realistic,
dated itinerary.

How to plan:
- Respect everything the traveller states as fixed (arrival, flights, dates, places). Fill the
  gaps around it. Never drop a place they named; if it does not fit, say so in the summary.
- Dates must chain: each stop's leave_date is the next stop's arrive_date (or the day before
  for an overnight journey). Cover the whole trip from start to end with no unexplained gap.
- Choose stays that make sense for the pace: avoid one-night hops except for transit.
- Transport between stops: the realistic way locals and backpackers actually go (domestic
  flight, sleeper train, bus, ferry, border crossing), with an honest duration and price.
- Account for season and events on those dates (weather on each coast, holidays, festivals,
  peak periods that sell out) and adjust the route when it matters.
- To-dos: concrete actions with a sensible deadline before the trip or before each leg
  (book what sells out, e-visa, insurance, vaccines, eSIM, cash, packing). Deadlines must be
  on or after today's date.
- Admin: entry rules and visas for each country, health, money, safety. State facts you are
  confident about and flag anything that changes often as "to verify".
- Use real place names. Coordinates are approximate city centres.`
    + (lang === 'fr'
      ? '\n\nEcris tous les textes en francais, avec les accents.'
      : '\n\nWrite every text field in English.')
}

function userPrompt(body: z.infer<typeof BodySchema>): string {
  const lines = [
    `Date du jour : ${body.today}`,
    `Debut du voyage : ${body.start_date ?? 'non fixe'}`,
    `Fin du voyage : ${body.end_date ?? 'non fixee'}`,
    `Voyageurs : ${body.travellers}`,
    `Budget : ${body.budget}`,
    `Rythme : ${body.pace}`,
  ]
  if (body.nationality) lines.push(`Nationalite des voyageurs : ${body.nationality}`)
  if (body.existing.length > 0) {
    lines.push(
      '',
      'Etapes deja enregistrees (a respecter, propose uniquement ce qui manque autour) :',
      ...body.existing.map((s) => `- ${s.name} : ${s.arrive_date ?? '?'} -> ${s.leave_date ?? '?'}`),
    )
  }
  lines.push('', 'Ce que les voyageurs ont ecrit :', '"""', body.raw, '"""')
  return lines.join('\n')
}

async function isAuthorised(token: string): Promise<boolean> {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL
  const anon = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY
  if (!url || !anon) return false
  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anon, Authorization: `Bearer ${token}` },
    })
    return res.ok
  } catch {
    return false
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Methode non autorisee' })
    return
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: "L'assistant n'est pas configure : ANTHROPIC_API_KEY manque sur Vercel." })
    return
  }

  const auth = req.headers.authorization
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token || !(await isAuthorised(token))) {
    res.status(401).json({ error: 'Connexion requise' })
    return
  }

  const parsed = BodySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Demande incomplete', details: parsed.error.issues })
    return
  }
  const body = parsed.data

  try {
    const client = new Anthropic()
    const response = await client.beta.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: betaZodOutputFormat(ItinerarySchema) },
      // En cas de refus par un filtre de securite, l'API bascule seule sur
      // un modele de repli adapte, sans liste a maintenir ici.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: systemPrompt(body.lang),
      messages: [{ role: 'user', content: userPrompt(body) }],
    })

    if (response.stop_reason === 'refusal' || !response.parsed_output) {
      res.status(502).json({ error: "L'assistant n'a pas pu proposer d'itineraire. Reformulez et reessayez." })
      return
    }
    res.status(200).json(response.parsed_output)
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      res.status(429).json({ error: 'Trop de demandes, reessayez dans une minute.' })
      return
    }
    const message = err instanceof Error ? err.message : 'Erreur inconnue'
    console.error('[itinerary] echec', message)
    res.status(502).json({ error: message })
  }
}
