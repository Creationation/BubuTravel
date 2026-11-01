import { useEffect, useRef, useState } from 'react'
import { runAiJob } from '../lib/aiJobs'
import { useAnalyzerOnline } from '../lib/ideas'
import type { Place } from '../lib/types'
import { usePlaces } from '../context/PlacesContext'
import { useI18n } from '../i18n/I18nContext'
import { ExternalIcon, PinIcon, SparkIcon } from './hub/icons'

/** Lien Google Maps : adresse trouvee, sinon nom + ville, sinon coordonnees. */
export function googleMapsUrl(place: Place): string {
  const q = place.details?.address
    ? `${place.details.name || place.name}, ${place.details.address}`
    : `${place.name}, ${place.city ?? ''} ${place.country}`
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q.trim())}`
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

export default function PlaceDetailsView({ place }: { place: Place }) {
  const { t, lang } = useI18n()
  const { reload } = usePlaces()
  const online = useAnalyzerOnline()
  const d = place.details
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const asked = useRef<string | null>(null)

  async function find() {
    setBusy(true)
    setError(null)
    try {
      await runAiJob('place_info', { place_id: place.id, lang }, place.trip_id)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // Ouverture d'un lieu sans infos : on les demande une fois, automatiquement
  useEffect(() => {
    if (d || asked.current === place.id || online === false) return
    if (online === null) return
    asked.current = place.id
    void find()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place.id, d, online])

  const video = videoLink(place.notes)
  const facts = d
    ? ([
        [t('pd.price'), d.price],
        [t('pd.hours'), d.hours],
        [t('pd.duration'), d.duration],
        [t('pd.bestTime'), d.best_time],
      ] as [string, string][]).filter(([, v]) => v)
    : []

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

      {busy && (
        <div className="card-feature flex items-center gap-3 p-4">
          <span className="glyph animate-pulse">
            <SparkIcon size={16} />
          </span>
          <p className="text-[13px] text-text-soft">{t('pd.searching')}</p>
        </div>
      )}
      {!d && !busy && online === false && <p className="chip chip-warn">{t('pd.offline')}</p>}
      {error && <p className="notice notice-bad">{error}</p>}

      {d && (
        <>
          {d.kind && <p className="eyebrow eyebrow-dot">{d.kind}</p>}
          {d.summary && <p className="text-[15px] leading-relaxed text-text-soft">{d.summary}</p>}
          {d.address && (
            <p className="flex items-start gap-2 text-[13px] text-text-muted">
              <PinIcon size={14} className="mt-0.5 shrink-0" />
              {d.address}
            </p>
          )}

          {facts.length > 0 && (
            <dl className="grid grid-cols-2 gap-2">
              {facts.map(([k, v]) => (
                <div key={k} className="rounded-2xl border border-line bg-surface p-3">
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">{k}</dt>
                  <dd className="mt-1 text-[13px] leading-snug">{v}</dd>
                </div>
              ))}
            </dl>
          )}

          {d.menu.length > 0 && (
            <div>
              <p className="eyebrow mb-2">{t('pd.menu')}</p>
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
                {d.menu.map((m) => (
                  <li key={m.name} className="flex items-baseline justify-between gap-3 px-3.5 py-2.5 text-[13px]">
                    <span>{m.name}</span>
                    {m.price && <span className="num shrink-0 font-semibold text-accent">{m.price}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(d.booking || d.booking_url) && (
            <div className="rounded-2xl border border-line bg-surface p-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">{t('pd.booking')}</p>
              {d.booking && <p className="mt-1 text-[13px] leading-relaxed">{d.booking}</p>}
              {d.booking_url && (
                <a href={d.booking_url} target="_blank" rel="noreferrer" className="btn btn-xs mt-2.5">
                  <ExternalIcon size={12} />
                  {t('pd.book')}
                </a>
              )}
            </div>
          )}

          {d.tips.length > 0 && (
            <div>
              <p className="eyebrow mb-2">{t('pd.tips')}</p>
              <ul className="space-y-1.5 text-[13px] text-text-soft">
                {d.tips.map((tip) => (
                  <li key={tip} className="flex gap-2">
                    <span className="text-accent">•</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          )}

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

      {!busy && (
        <button onClick={() => void find()} className="btn btn-quiet btn-xs">
          <SparkIcon size={12} />
          {d ? t('pd.refresh') : t('pd.find')}
        </button>
      )}
    </section>
  )
}
