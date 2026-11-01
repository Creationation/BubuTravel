/**
 * Photo d'illustration d'un lieu, cherchee sur Wikipedia (photos sous
 * licence libre, API ouverte aux navigateurs avec origin=*). On essaie le
 * francais puis l'anglais, avec le nom du lieu et sa ville.
 *
 * Renvoie l'URL d'une vignette, ou '' si rien n'a ete trouve : la chaine
 * vide est enregistree pour ne pas refaire la recherche a chaque ouverture.
 */

type WikiPage = { index?: number; title: string; thumbnail?: { source: string } }

async function searchWiki(lang: 'fr' | 'en', query: string): Promise<string> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrsearch: query,
    gsrlimit: '4',
    gsrnamespace: '0',
    prop: 'pageimages',
    piprop: 'thumbnail',
    pithumbsize: '480',
  })
  const res = await fetch(`https://${lang}.wikipedia.org/w/api.php?${params}`)
  if (!res.ok) return ''
  const data = (await res.json()) as { query?: { pages?: Record<string, WikiPage> } }
  const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => (a.index ?? 99) - (b.index ?? 99))
  // On ignore les cartes et drapeaux, qui n'illustrent pas un lieu a visiter
  const hit = pages.find(
    (p) => p.thumbnail?.source && !/(map|carte|flag|drapeau|locator|location|\.svg)/i.test(p.thumbnail.source),
  )
  return hit?.thumbnail?.source ?? ''
}

/** Nom nettoye : « Wat Pho (Bouddha couché) » -> « Wat Pho » */
function cleanName(name: string): string {
  return name.replace(/\(.*?\)/g, '').replace(/\s+[–-]\s+.*/, '').trim()
}

export async function findPlaceImage(name: string, city: string | null, country: string): Promise<string> {
  const base = cleanName(name)
  const attempts: ['fr' | 'en', string][] = [
    ['fr', `${base} ${city ?? ''}`.trim()],
    ['en', `${base} ${city ?? ''}`.trim()],
    ['en', base],
    ['fr', `${base} ${country}`.trim()],
  ]
  for (const [lang, q] of attempts) {
    try {
      const url = await searchWiki(lang, q)
      if (url) return url
    } catch {
      // Reseau indisponible : on reessaiera plus tard (null reste null)
      throw new Error('offline')
    }
  }
  return ''
}
