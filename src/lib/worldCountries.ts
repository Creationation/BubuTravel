import type { Feature, FeatureCollection, Geometry } from 'geojson'

/**
 * Contours des pays (world-atlas, Natural Earth 1:50m), charges a la demande
 * et livres avec l'app : aucun service exterieur. Chaque pays recoit son
 * code ISO et ses noms francais et anglais, pour le relier aux lieux du
 * carnet, dont le pays est ecrit en clair (« Thaïlande », « Vietnam »...).
 */

export type CountryProps = { code: string; nameFr: string; nameEn: string; key: string }
export type CountryFeature = Feature<Geometry, CountryProps>

/** « Viêt Nam », « Vietnam », « viet-nam » -> « vietnam » */
export function countryKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
}

// Noms abreges de world-atlas sans equivalent direct dans Intl.DisplayNames
const ALIASES: Record<string, string> = {
  'W. Sahara': 'EH',
  'Dem. Rep. Congo': 'CD',
  'Central African Rep.': 'CF',
  'Bosnia and Herz.': 'BA',
  'Dominican Rep.': 'DO',
  'S. Sudan': 'SS',
  'Eq. Guinea': 'GQ',
  'Solomon Is.': 'SB',
  'N. Cyprus': 'CY',
  "Côte d'Ivoire": 'CI',
  eSwatini: 'SZ',
  Macedonia: 'MK',
  'United States of America': 'US',
  'Falkland Is.': 'FK',
  'Fr. S. Antarctic Lands': 'TF',
  'Timor-Leste': 'TL',
  'Myanmar': 'MM',
  Czechia: 'CZ',
  'Faeroe Is.': 'FO',
  'Fr. Polynesia': 'PF',
  'Cayman Is.': 'KY',
  'Turks and Caicos Is.': 'TC',
  'U.S. Virgin Is.': 'VI',
  'British Virgin Is.': 'VG',
  'Marshall Is.': 'MH',
  'N. Mariana Is.': 'MP',
  'Cook Is.': 'CK',
  'Heard I. and McDonald Is.': 'HM',
  'S. Geo. and the Is.': 'GS',
  'St. Kitts and Nevis': 'KN',
  'St. Vin. and Gren.': 'VC',
  'São Tomé and Principe': 'ST',
  'Antigua and Barb.': 'AG',
  'Wallis and Futuna Is.': 'WF',
  'St. Pierre and Miquelon': 'PM',
  'Br. Indian Ocean Ter.': 'IO',
  'Åland': 'AX',
  Kosovo: 'XK',
  Somaliland: 'SO',
}

function englishToCode(): Map<string, string> {
  const map = new Map<string, string>()
  const en = new Intl.DisplayNames(['en'], { type: 'region' })
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  for (const a of A)
    for (const b of A) {
      const code = a + b
      try {
        const name = en.of(code)
        if (name && name !== code) map.set(countryKey(name), code)
      } catch {
        // code inexistant
      }
    }
  return map
}

let cache: Promise<FeatureCollection<Geometry, CountryProps>> | null = null

export function loadCountries(): Promise<FeatureCollection<Geometry, CountryProps>> {
  if (cache) return cache
  cache = (async () => {
    const [{ feature }, topo] = await Promise.all([
      import('topojson-client'),
      import('world-atlas/countries-50m.json'),
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const world = (topo as any).default ?? topo
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fc = feature(world, world.objects.countries) as any as FeatureCollection<Geometry, { name: string }>
    const byEnglish = englishToCode()
    const fr = new Intl.DisplayNames(['fr'], { type: 'region' })
    const features: CountryFeature[] = fc.features.map((f) => {
      const nameEn = f.properties?.name ?? ''
      const code = ALIASES[nameEn] ?? byEnglish.get(countryKey(nameEn)) ?? ''
      let nameFr = nameEn
      try {
        if (code) nameFr = fr.of(code) ?? nameEn
      } catch {
        // garde le nom anglais
      }
      return { ...f, properties: { code, nameFr, nameEn, key: countryKey(nameFr) } }
    })
    return { type: 'FeatureCollection', features }
  })()
  return cache
}

/** Le pays d'un lieu correspond-il a ce contour ? (nom FR, nom EN ou code) */
export function sameCountry(props: CountryProps, placeCountry: string): boolean {
  const k = countryKey(placeCountry)
  return k === props.key || k === countryKey(props.nameEn) || k === props.code.toLowerCase()
}
