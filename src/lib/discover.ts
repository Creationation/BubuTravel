import type { Place } from './types'
import type { Key } from '../i18n/fr'

/**
 * Familles de lieux pour ranger « A decouvrir » et la liste des envies :
 * deduites du type trouve par l'IA (details.kind), du nom et des notes.
 */
export type Family = 'culture' | 'nature' | 'food' | 'nightlife' | 'market' | 'activity' | 'wellness' | 'other'

const RULES: [Family, RegExp][] = [
  ['wellness', /spa|massage|soin|wellness|clinic|clinique|h[oô]pital|hospital|dental|dentaire|yoga|sauna|beaut[ée]|nail|coiff/],
  ['nightlife', /\bbar\b|rooftop|club|cocktail|pub|nightlife|vie nocturne|speakeasy|bi[eè]re|beer|festival|edc|concert|soir[ée]e/],
  ['food', /restaurant|caf[ée]|coffee|street ?food|cuisine|buffet|brunch|food|bistro|boulangerie|bakery|p[aâ]tisserie|glace|ice ?cream|th[ée]|tea|dessert|noodle|ph[oở]|b[uú]n|pad thai|seafood|fruits de mer|crab|crabe|affogato|dim sum|mango|manger|repas/],
  ['market', /march[ée]|market|bazar|shopping|mall|boutique|centre commercial|night market|souvenir|bijou|jewel|tailleur|tailor|perles?/],
  ['nature', /plage|beach|[îi]le|island|baie|bay|cascade|waterfall|parc|park|jardin|garden|montagne|mountain|grotte|cave|lac|lake|rivi[eè]re|river|jungle|for[eê]t|forest|rizi[eè]re|rice|point de vue|viewpoint|vue|snorkel|plong[ée]e|coucher de soleil|sunset/],
  ['culture', /temple|wat\b|pagode|pagoda|palais|palace|mus[ée]e|museum|cath[ée]drale|[ée]glise|church|mosqu[ée]e|sanctuaire|shrine|monument|histor|vieille ville|old town|quartier|chinatown|statue|bouddha|buddha|art|galerie|gallery|th[ée][aâ]tre|spectacle|show/],
  ['activity', /excursion|tour|bateau|boat|kayak|cours|class|atelier|workshop|randonn[ée]e|hike|trek|v[ée]lo|bike|scooter|zip|aventure|safari|croisi[eè]re|cruise|visite guid[ée]e/],
]

export function familyOf(p: Place): Family {
  // La famille choisie par l'IA au remplissage fait foi
  const chosen = (p.details as { family?: Family } | null)?.family
  if (chosen && chosen !== 'other') return chosen
  const text = `${p.details?.kind ?? ''} ${p.name} ${(p.notes ?? '').slice(0, 200)}`.toLowerCase()
  for (const [fam, re] of RULES) if (re.test(text)) return fam
  return 'other'
}

export const FAMILIES: { id: Family; emoji: string; label: Key }[] = [
  { id: 'culture', emoji: '🛕', label: 'fam.culture' },
  { id: 'nature', emoji: '🏝️', label: 'fam.nature' },
  { id: 'food', emoji: '🍜', label: 'fam.food' },
  { id: 'nightlife', emoji: '🍸', label: 'fam.nightlife' },
  { id: 'market', emoji: '🛍️', label: 'fam.market' },
  { id: 'activity', emoji: '🚤', label: 'fam.activity' },
  { id: 'wellness', emoji: '💆', label: 'fam.wellness' },
  { id: 'other', emoji: '✨', label: 'fam.other' },
]

export const emojiOf = (f: Family) => FAMILIES.find((x) => x.id === f)?.emoji ?? '✨'

/** Image principale : vraie photo du lieu d'abord, image de video ensuite. */
export const imageOf = (p: Place) =>
  p.gallery?.find((u) => !u.includes('idea-frames/') || u.includes('idea-frames/places/')) || p.image_url || p.gallery?.[0] || null

/* ------------------------------------------------------------ a faire */

export type Topic = 'papers' | 'transport' | 'stay' | 'money' | 'health' | 'phone' | 'packing' | 'activities' | 'other'

const TOPIC_RULES: [Topic, RegExp][] = [
  ['papers', /passeport|passport|visa|e-?visa|douane|immigration|entr[ée]e|carte d.identit|permis|assurance|insurance|papier/],
  ['health', /sant[ée]|health|vaccin|m[ée]dic|pharma|h[oô]pital|hospital|clinique|clinic|moustique|mosquito|dent|ent\b|docteur|doctor/],
  ['money', /argent|money|cash|carte bancaire|card|banque|bank|atm|distributeur|change|paiement|payment|wise|revolut|budget|d[ée]pense/],
  ['phone', /esim|sim|appli|app\b|apps|grab|bolt|t[ée]l[ée]phone|phone|internet|wifi|roaming|whatsapp|google maps|t[ée]l[ée]charger|download/],
  ['transport', /vol\b|vols|flight|a[ée]roport|airport|train|bus|ferry|bateau|taxi|scooter|moto|transfert|transfer|trajet|navette|airasia|scoot|airpaz|billet d.avion|compagnie a[ée]rienne|itin[ée]raire/],
  ['stay', /h[oô]tel|airbnb|h[ée]bergement|logement|check-?in|check-?out|booking\.com|agoda|chambre|resort|hostel/],
  ['packing', /valise|sac|bagage|luggage|packing|emporter|adaptateur|adapter|chargeur|cr[eè]me solaire|v[eê]tement|maillot|lunettes/],
  ['activities', /r[ée]server|book|billet|ticket|excursion|tour|cours|class|visite|festival|edc|spectacle|restaurant|r[ée]servation/],
]

export function topicOf(title: string, notes: string | null, kind?: string): Topic {
  if (kind === 'packing') return 'packing'
  const text = `${title} ${(notes ?? '').slice(0, 200)}`.toLowerCase()
  for (const [topic, re] of TOPIC_RULES) if (re.test(text)) return topic
  return 'other'
}

export const TOPICS: { id: Topic; emoji: string; label: Key }[] = [
  { id: 'papers', emoji: '🛂', label: 'topic.papers' },
  { id: 'transport', emoji: '✈️', label: 'topic.transport' },
  { id: 'stay', emoji: '🏨', label: 'topic.stay' },
  { id: 'activities', emoji: '🎟️', label: 'topic.activities' },
  { id: 'money', emoji: '💳', label: 'topic.money' },
  { id: 'phone', emoji: '📱', label: 'topic.phone' },
  { id: 'health', emoji: '💊', label: 'topic.health' },
  { id: 'packing', emoji: '🧳', label: 'topic.packing' },
  { id: 'other', emoji: '📝', label: 'topic.other' },
]
