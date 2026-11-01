import { useEffect, useState } from 'react'
import { runAiJob } from '../lib/aiJobs'
import { useAnalyzerOnline } from '../lib/ideas'
import type { Place, PlaceDetails } from '../lib/types'
import { usePlaces } from '../context/PlacesContext'
import { useI18n } from '../i18n/I18nContext'
import { ExternalIcon, PinIcon, SparkIcon } from './hub/icons'
import ClampText from './ClampText'

/** La position du lieu est-elle fiable (et pas le centre de la ville) ? */
export function isExact(place: Place): boolean {
  if (place.details?.gps_exact) return true
  return !(place.notes ?? '').includes('Position approximative')
}

/**
 * Lien Google Maps : le point GPS exact quand on l'a (le pin tombe pile sur
 * le lieu), sinon une recherche par nom et adresse.
 */
export function googleMapsUrl(place: Place): string {
  if (isExact(place)) {
    return `https://www.google.com/maps/search/?api=1&query=${place.lat.toFixed(6)},${place.lng.toFixed(6)}`
  }
  const q = place.details?.address
    ? `${place.details.name || place.name}, ${place.details.address}`
    : `${place.name}, ${place.city ?? ''} ${place.country}`
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q.trim())}`
}

export function directionsUrl(place: Place): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${place.lat.toFixed(6)},${place.lng.toFixed(6)}`
}

function Copy({ text }: { text: string }) {
  const { t } = useI18n()
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          window.setTimeout(() => setDone(false), 1500)
        } catch {
          // presse-papiers indisponible
        }
      }}
      className="shrink-0 text-[11px] font-semibold text-accent"
    >
      {done ? t('pd.copied') : t('pd.copy')}
    </button>
  )
}

/** Premier lien de video dans les notes (Instagram, TikTok, YouTube). */
function videoLink(notes: string | null): string | null {
  const m = (notes ?? '').match(/https?:\/\/(www\.)?(instagram\.com|tiktok\.com|youtube\.com|youtu\.be)\/\S+/)
  return m ? m[0] : null
}

/**
 * Haut de la fiche d'un lieu : galerie plein cadre, puis infos pratiques
 * (prix, horaires, a gouter, reservation, conseils) et bouton Google Maps.
 * Sans infos, l'analyseur du PC les cherche des l'ouverture.
 */
export function PlaceHero({ place, onZoom }: { place: Place; onZoom: (urls: string[], i: number) => void }) {
  const images = [...new Set([...(place.gallery ?? []), ...(place.image_url ? [place.image_url] : [])])]
  const [failed, setFailed] = useState<Set<string>>(new Set())
  const shown = images.filter((u) => !failed.has(u))
  if (shown.length === 0) return null
  const [main, ...rest] = shown
  return (
    <div className="relative">
      <button onClick={() => onZoom(shown, 0)} className="block h-56 w-full overflow-hidden bg-surface-2 sm:h-64">
        <img
          src={main}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed((s) => new Set(s).add(main))}
          className="h-full w-full object-cover transition-transform duration-700 hover:scale-105"
        />
      </button>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
      {rest.length > 0 && (
        <div className="nav-scroll absolute inset-x-3 bottom-3 flex gap-2 overflow-x-auto">
          {rest.slice(0, 8).map((u, i) => (
            <button
              key={u}
              onClick={() => onZoom(shown, i + 1)}
              className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border-2 border-white/70 shadow-lg"
            >
              <img
                src={u}
                alt=""
                referrerPolicy="no-referrer"
                onError={() => setFailed((s) => new Set(s).add(u))}
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

type Proposal = PlaceDetails & { lat?: number | null; lng?: number | null; images?: string[]; gps_exact?: boolean }

export default function PlaceDetailsView({ place }: { place: Place }) {
  const { t, lang } = useI18n()
  const { edit } = usePlaces()
  const online = useAnalyzerOnline()
  const d = place.details
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [useName, setUseName] = useState(true)
  const [saved, setSaved] = useState(false)

  // Changement de lieu : on repart de zero
  useEffect(() => {
    setProposal(null)
    setError(null)
    setSaved(false)
  }, [place.id])

  /** Recherche en mode apercu : rien n'est ecrit avant « Appliquer ». */
  async function fill() {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const res = await runAiJob<Proposal>('place_info', { place_id: place.id, lang, preview: true }, place.trip_id)
      setProposal(res)
      setUseName(Boolean(res.name) && res.name.trim().toLowerCase() !== place.name.trim().toLowerCase())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    if (!proposal) return
    setBusy(true)
    try {
      const images = proposal.images ?? []
      const frames = (place.gallery ?? []).filter((u) => u.includes('idea-frames'))
      const gallery = [...images, ...frames.filter((u) => !images.includes(u))].slice(0, 10)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { lat, lng, ...details } = proposal
      await edit(place.id, {
        details: { ...details, gps_exact: lat != null && lng != null },
        ...(gallery.length ? { gallery, image_url: gallery[0] } : {}),
        ...(lat != null && lng != null ? { lat, lng } : {}),
        ...(useName && proposal.name ? { name: proposal.name.slice(0, 120) } : {}),
      })
      setProposal(null)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const video = videoLink(place.notes)

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <a href={googleMapsUrl(place)} target="_blank" rel="noreferrer" className="btn btn-accent flex-1">
          <PinIcon size={15} />
          {t('pd.maps')}
        </a>
        {video && (
          <a href={video} target="_blank" rel="noreferrer" className="btn">
            <ExternalIcon size={14} />
            {t('pd.video')}
          </a>
        )}
      </div>

      {/* Adresse et GPS */}
      <div className="rounded-2xl border border-line bg-surface p-3.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">{t('pd.where')}</p>
          <span className={`chip py-0 ${d?.gps_exact ? 'chip-ok' : 'chip-warn'}`}>
            {d?.gps_exact ? t('pd.exact') : t('pd.approx')}
          </span>
        </div>
        <div className="mt-2 flex items-start gap-2">
          <p className={`min-w-0 flex-1 text-[14px] leading-snug ${d?.address ? '' : 'text-text-muted'}`}>
            {d?.address || t('pd.noAddress')}
          </p>
          {d?.address && <Copy text={d.address} />}
        </div>
        <div className="mt-2 flex items-center gap-2 border-t border-dashed border-line pt-2">
          <span className="text-[11px] font-semibold text-text-muted">{t('pd.gps')}</span>
          <span className="num min-w-0 flex-1 truncate font-mono text-[13px]">
            {place.lat.toFixed(6)}, {place.lng.toFixed(6)}
          </span>
          <Copy text={`${place.lat.toFixed(6)}, ${place.lng.toFixed(6)}`} />
        </div>
        <a href={directionsUrl(place)} target="_blank" rel="noreferrer" className="btn btn-xs mt-3">
          <PinIcon size={12} />
          {t('pd.route')}
        </a>
      </div>

      {/* Remplir les informations (avec validation) */}
      {!proposal && (
        <div className="card-feature p-4">
          <button onClick={() => void fill()} disabled={busy || online === false} className="btn btn-accent w-full">
            <SparkIcon size={15} />
            {busy ? t('common.wait') : t('pd.fill')}
          </button>
          <p className="mt-2 text-[12px] leading-snug text-text-muted">
            {busy ? t('pd.waiting') : online === false ? t('pd.offline') : t('pd.fillHint')}
          </p>
          {saved && <p className="chip chip-ok mt-2">{t('pd.applied')}</p>}
        </div>
      )}
      {error && <p className="notice notice-bad">{error}</p>}

      {proposal && (
        <div className="overflow-hidden rounded-2xl border-2 border-accent/50 bg-surface">
          <div className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
            <p className="eyebrow eyebrow-dot">{t('pd.previewTitle')}</p>
            {(proposal.images?.length ?? 0) > 0 && (
              <span className="chip num py-0">{t('pd.photos', { n: proposal.images!.length })}</span>
            )}
          </div>
          {(proposal.images?.length ?? 0) > 0 && (
            <div className="nav-scroll flex gap-2 overflow-x-auto p-3">
              {proposal.images!.map((u) => (
                <img key={u} src={u} alt="" referrerPolicy="no-referrer" className="h-24 w-32 shrink-0 rounded-xl object-cover" />
              ))}
            </div>
          )}
          <div className="space-y-3 px-3.5 pb-3.5">
            <p className="text-[16px] font-bold">{proposal.name}</p>
            {proposal.address && <p className="text-[13px] text-text-muted">{proposal.address}</p>}
            <Info d={proposal} />
            {proposal.name && proposal.name !== place.name && (
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={useName} onChange={(e) => setUseName(e.target.checked)} />
                {t('pd.applyName', { name: proposal.name })}
              </label>
            )}
            <div className="flex gap-2 pt-1">
              <button onClick={() => void apply()} disabled={busy} className="btn btn-accent flex-1">
                {t('pd.apply')}
              </button>
              <button onClick={() => setProposal(null)} className="btn">
                {t('pd.discard')}
              </button>
            </div>
          </div>
        </div>
      )}

      {d && !proposal && (
        <>
          {d.kind && <p className="eyebrow eyebrow-dot">{d.kind}</p>}
          {d.summary && <ClampText text={d.summary} lines={3} className="text-[15px] leading-relaxed text-text-soft" />}
          <Info d={d} />
          {d.sources.length > 0 && (
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-muted">
              <span>{t('pd.sources')} :</span>
              {d.sources.slice(0, 4).map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="hover:text-text hover:underline">
                  {s.title || s.url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}
                </a>
              ))}
            </p>
          )}
        </>
      )}
    </section>
  )
}

/**
 * Infos pratiques en liste pleine largeur : une ligne par info, valeur
 * repliee sur 2 lignes. Plus de colonnes etroites qui s'etirent en hauteur.
 */
function Info({ d }: { d: PlaceDetails }) {
  const { t } = useI18n()
  const rows = (
    [
      [t('pd.price'), d.price],
      [t('pd.hours'), d.hours],
      [t('pd.duration'), d.duration],
      [t('pd.bestTime'), d.best_time],
      [t('pd.booking'), d.booking],
    ] as [string, string][]
  ).filter(([, v]) => v)
  return (
    <div className="space-y-4">
      {rows.length > 0 && (
        <dl className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {rows.map(([k, v]) => (
            <div key={k} className="px-3.5 py-2.5">
              <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-muted">{k}</dt>
              <dd className="mt-0.5">
                <ClampText text={v} lines={2} className="text-[14px] leading-snug" />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {d.booking_url && (
        <a href={d.booking_url} target="_blank" rel="noreferrer" className="btn btn-xs">
          <ExternalIcon size={12} />
          {t('pd.book')}
        </a>
      )}
      {d.menu.length > 0 && (
        <div>
          <p className="eyebrow mb-2">{t('pd.menu')}</p>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {d.menu.slice(0, 8).map((m) => (
              <li key={m.name} className="flex items-baseline justify-between gap-3 px-3.5 py-2.5 text-[14px]">
                <span className="min-w-0 truncate">{m.name}</span>
                {m.price && <span className="num shrink-0 font-bold text-accent">{m.price}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {d.tips.length > 0 && (
        <div>
          <p className="eyebrow mb-2">{t('pd.tips')}</p>
          <ul className="space-y-1.5 text-[14px] text-text-soft">
            {d.tips.slice(0, 5).map((tip) => (
              <li key={tip} className="flex gap-2">
                <span className="text-accent">•</span>
                <span className="min-w-0">{tip}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
