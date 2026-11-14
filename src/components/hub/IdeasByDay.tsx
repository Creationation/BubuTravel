import { useState } from 'react'
import { groupIdeasByDay } from '../../lib/ideas'
import type { LinkIdea } from '../../lib/types'
import { useI18n } from '../../i18n/I18nContext'
import { countryName } from '../../lib/countryName'
import PlaceSheet from '../PlaceSheet'
import IdeaCard from './IdeaCard'

/**
 * Les idees regroupees par jour d'envoi, la plus recente en haut.
 * Une idee deja posee sur la carte = une ligne compacte (toucher = fiche du lieu) ;
 * une idee en attente, en cours, en echec ou pas encore placee = la carte complete.
 */
export default function IdeasByDay({ ideas, defaultTripId }: { ideas: LinkIdea[]; defaultTripId?: string | null }) {
  const { t, locale } = useI18n()
  const groups = groupIdeasByDay(ideas)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [placeId, setPlaceId] = useState<string | null>(null)

  function dayLabel(day: string) {
    const today = new Date()
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (day === iso(today)) return t('idea.today')
    const y = new Date(today)
    y.setDate(y.getDate() - 1)
    if (day === iso(y)) return t('idea.yesterday')
    const [yy, mm, dd] = day.split('-').map(Number)
    const label = new Date(yy, mm - 1, dd).toLocaleDateString(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      ...(yy !== today.getFullYear() ? { year: 'numeric' } : {}),
    })
    return label.charAt(0).toUpperCase() + label.slice(1)
  }

  return (
    <div className="space-y-8">
      {groups.map(({ day, ideas: list }, i) => {
        const isOpen = open[day] ?? i < 3
        const placed = list.filter((x) => x.place_id && (x.status === 'archived' || x.status === 'ready'))
        const others = list.filter((x) => !placed.includes(x))
        return (
          <section key={day}>
            <button
              onClick={() => setOpen((o) => ({ ...o, [day]: !isOpen }))}
              className="flex w-full items-baseline gap-3 border-b border-line pb-2 text-left"
            >
              <h3 className="text-[1.15rem] font-extrabold">{dayLabel(day)}</h3>
              <span className="text-[13px] text-text-muted">{t('idea.count', { n: list.length })}</span>
              <span className="ml-auto text-[12px] font-semibold text-text-muted">
                {isOpen ? t('idea.hideDay') : t('idea.showDay')}
              </span>
            </button>
            {isOpen && (
              <div className="mt-4 space-y-4">
                {others.length > 0 && (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {others.map((idea) => (
                      <IdeaCard key={idea.id} idea={idea} defaultTripId={defaultTripId} />
                    ))}
                  </div>
                )}
                {placed.length > 0 && (
                  <div className="grid gap-2 md:grid-cols-2">
                    {placed.map((idea) => (
                      <PlacedIdea key={idea.id} idea={idea} onOpen={() => setPlaceId(idea.place_id)} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        )
      })}
      {placeId && <PlaceSheet placeId={placeId} onClose={() => setPlaceId(null)} />}
    </div>
  )
}

function PlacedIdea({ idea, onOpen }: { idea: LinkIdea; onOpen: () => void }) {
    const { t } = useI18n()
    const a = idea.analysis
    const where = a ? [a.place?.city, countryName(a.place?.country ?? '')].filter(Boolean).join(', ') : ''
    return (
      <button onClick={onOpen} className="card flex w-full items-center gap-3 p-2.5 text-left hover:border-accent">
        {idea.thumbnail ? (
          <img
            src={idea.thumbnail}
            alt=""
            className="h-16 w-16 shrink-0 rounded-xl object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="glyph h-16 w-16 shrink-0 rounded-xl text-2xl">📍</span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-bold">{a?.name || idea.title || idea.url}</span>
          {where && <span className="block truncate text-[13px] text-text-muted">{where}</span>}
          {idea.note && <span className="block truncate text-[12px] text-text-soft">« {idea.note} »</span>}
        </span>
        <span className="chip chip-ok shrink-0 text-[11px]">{t('idea.onMap')}</span>
      </button>
    )
}
