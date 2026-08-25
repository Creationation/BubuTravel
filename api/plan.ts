import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * Planificateur assiste.
 *
 * Cette fonction tourne cote serveur pour une seule raison : la cle API
 * Anthropic ne doit jamais atteindre le navigateur. Elle est lue dans les
 * variables d'environnement Vercel et ne figure nulle part dans le bundle.
 *
 * L'appel est aussi reserve aux comptes connectes : le jeton Supabase est
 * verifie avant tout appel au modele, sinon n'importe qui pourrait consommer
 * le credit en appelant l'URL directement.
 */

const ActivitySchema = z.object({
  name: z.string().describe("Nom de l'endroit ou de l'activite"),
  city: z.string().describe('Ville'),
  country: z.string().describe('Pays'),
  address: z.string().describe('Adresse indicative, rue et numero si connus'),
  day: z.number().int().describe('Jour du sejour, a partir de 1'),
  moment: z.enum(['matin', 'midi', 'apres-midi', 'soir']),
  kind: z.string().describe('Nature : musee, restaurant, randonnee, marche, quartier...'),
  why: z.string().describe('Pourquoi cet endroit vaut le detour, deux phrases maximum'),
  duration_hours: z.number().describe('Duree conseillee, en heures'),
  price_estimate: z.number().describe('Budget indicatif par personne, 0 si gratuit'),
  currency: z.string().describe('Code de devise, EUR par defaut'),
  booking: z.string().describe("Ce qu'il faut reserver, ou chaine vide"),
  lat: z.number().describe('Latitude approximative'),
  lng: z.number().describe('Longitude approximative'),
})

const PlanSchema = z.object({
  summary: z.string().describe('Resume du sejour propose, trois phrases maximum'),
  total_estimate: z.number().describe('Budget total indicatif par personne'),
  currency: z.string(),
  activities: z.array(ActivitySchema),
})

const BodySchema = z.object({
  mode: z.enum(['plan', 'replace']).default('plan'),
  destination: z.string().min(2).max(120),
  days: z.number().int().min(1).max(30),
  travellers: z.number().int().min(1).max(20).default(2),
  interests: z.array(z.string().max(40)).max(12).default([]),
  budget: z.enum(['petit', 'moyen', 'confortable', 'luxe']).default('moyen'),
  pace: z.enum(['tranquille', 'equilibre', 'dense']).default('equilibre'),
  season: z.string().max(40).default(''),
  notes: z.string().max(600).default(''),
  lang: z.enum(['fr', 'en']).default('fr'),
  /** Pour le mode replace : la liste actuelle et l'activite a remplacer. */
  current: z.array(ActivitySchema).max(60).default([]),
  replaceIndex: z.number().int().min(0).optional(),
})

function systemPrompt(lang: 'fr' | 'en'): string {
  const common = `You plan trips. Propose real, existing places, never invented ones.
Be concrete: a named place, an indicative address, a realistic duration and price.
When you are unsure of a detail such as an exact street number or an opening price,
give your best estimate rather than a placeholder, and keep it plausible.
Spread the activities across the days and moments of the stay, and avoid sending
travellers back and forth across a city on the same day: group what is close together.
Prices are per person in the local currency of the destination.`

  return lang === 'fr'
    ? `${common}\n\nEcris tous les champs textuels en francais.`
    : `${common}\n\nWrite every text field in English.`
}

function userPrompt(body: z.infer<typeof BodySchema>): string {
  const lines = [
    `Destination : ${body.destination}`,
    `Duree : ${body.days} jour(s)`,
    `Voyageurs : ${body.travellers}`,
    `Budget : ${body.budget}`,
    `Rythme : ${body.pace}`,
  ]
  if (body.season) lines.push(`Periode : ${body.season}`)
  if (body.interests.length > 0) lines.push(`Centres d'interet : ${body.interests.join(', ')}`)
  if (body.notes) lines.push(`Precisions : ${body.notes}`)

  if (body.mode === 'replace' && body.replaceIndex !== undefined) {
    const target = body.current[body.replaceIndex]
    const others = body.current
      .filter((_, i) => i !== body.replaceIndex)
      .map((a) => `- jour ${a.day} ${a.moment} : ${a.name} (${a.kind})`)
      .join('\n')
    lines.push(
      '',
      `Remplace UNE seule activite : « ${target?.name ?? ''} », jour ${target?.day ?? 1} ${
        target?.moment ?? ''
      }.`,
      'Propose une alternative differente, au meme moment de la meme journee, qui ne fasse doublon avec aucune de celles deja retenues :',
      others || '(aucune autre)',
      '',
      "Renvoie la liste complete, les autres activites inchangees, avec seulement celle-la remplacee.",
    )
  } else {
    const perDay = body.pace === 'tranquille' ? 2 : body.pace === 'dense' ? 5 : 3
    lines.push('', `Propose environ ${perDay} activites par jour.`)
  }

  return lines.join('\n')
}

/** Le compte doit exister et le jeton doit etre valide. */
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
    res.status(503).json({
      error:
        "Le planificateur n'est pas configure : ANTHROPIC_API_KEY manque dans les variables d'environnement.",
    })
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
    const response = await client.messages.parse({
      model: 'claude-opus-5',
      max_tokens: 16000,
      // Un itineraire coherent demande de la reflexion : quoi grouper, quoi
      // ecarter, dans quel ordre.
      thinking: { type: 'adaptive' },
      system: systemPrompt(body.lang),
      messages: [{ role: 'user', content: userPrompt(body) }],
      output_config: { format: zodOutputFormat(PlanSchema) },
    })

    if (!response.parsed_output) {
      res.status(502).json({ error: "Le modele n'a pas renvoye de plan exploitable." })
      return
    }

    res.status(200).json(response.parsed_output)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue'
    console.error('[plan] echec', message)
    res.status(502).json({ error: message })
  }
}
