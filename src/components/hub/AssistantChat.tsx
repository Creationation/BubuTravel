import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useAiJobs } from '../../context/AiJobsContext'
import { usePlaces } from '../../context/PlacesContext'
import { searchPlaces } from '../../lib/geocode'
import { compressImage } from '../../lib/images'
import { supabase } from '../../lib/supabase'
import { shortDate } from '../../lib/tripDates'
import { addDaysIso } from '../../lib/tripDates'
import { isStay, stopOnDay } from '../../lib/schedule'
import { useMemo } from 'react'
import type { Trip } from '../../lib/types'
import type { TripHub } from '../../lib/useTripHub'
import { useI18n } from '../../i18n/I18nContext'
import AiGauge from '../AiGauge'

const MAX_PHOTOS = 20
const BUCKET = 'assistant'

type Action = {
  type: 'add_place' | 'schedule' | 'add_todo' | 'add_stay' | 'add_stop'
  label: string
  place_id: string
  name: string
  city: string
  country: string
  lat: number | null
  lng: number | null
  date: string
  time: string
  minutes: number | null
  notes: string
  stay_address?: string
  stay_url?: string
  leave_date?: string
}

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  images: string[]
  actions: Action[]
  applied: number[]
  status: string
  created_at: string
}

const db = () => supabase as unknown as { from: (t: string) => ReturnType<typeof supabase.from> }

/**
 * L'assistant prive : une vraie conversation sur le voyage. On peut joindre
 * jusqu'a 20 photos (menu, panneau, capture d'ecran...), il les regarde, pose
 * des questions s'il lui manque quelque chose, et propose des actions
 * (ajouter un lieu, le placer un jour, une chose a faire) qu'on applique
 * d'un toucher. La conversation est privee : chacun a la sienne.
 */
export default function AssistantChat({ trip, hub }: { trip: Trip; hub: TripHub }) {
  const { t, lang, locale } = useI18n()
  const { user } = useAuth()
  const { add, edit, places } = usePlaces()
  const { queue, jobs } = useAiJobs()
  const [messages, setMessages] = useState<Message[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [text, setText] = useState('')
  const [files, setFiles] = useState<{ file: File; preview: string }[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const planningPrompts = useMemo(() => {
    if (!trip.start_date || !trip.end_date || trip.end_date < trip.start_date) return []
    const gaps: { date: string; activity: boolean; stay: boolean; city: boolean }[] = []
    for (let date = trip.start_date; date <= trip.end_date; date = addDaysIso(date, 1)) {
      const stop = stopOnDay(date, hub.stops)
      const activities = places.some((p) => p.trip_id === trip.id && p.visit_date === date && p.status === 'wishlist' && !isStay(p))
      const needsStay = hub.stops.some((s) => s.arrive_date && s.arrive_date <= date && (s.leave_date ? date < s.leave_date : date === s.arrive_date) && !s.stay_name && !s.stay_address)
      if (!stop || !activities || needsStay) gaps.push({ date, activity: !activities, stay: needsStay, city: !stop })
    }
    return gaps.slice(0, 6)
  }, [trip.id, trip.start_date, trip.end_date, hub.stops, places])

  function askAboutGap(gap: { date: string; activity: boolean; stay: boolean; city: boolean }) {
    const needs = [gap.city && 'propose une ville/étape qui s’insère dans l’itinéraire', gap.stay && 'cherche des hébergements réellement ouverts et disponibles à vérifier (ne réserve rien)', gap.activity && 'propose des activités adaptées à nos envies, y compris des idées nouvelles'].filter(Boolean).join(' ; ')
    setText(`Aide-nous à compléter le ${shortDate(gap.date, locale, true)} : ${needs}. Vérifie les jours fériés locaux, les jours et horaires d’ouverture, les fermetures saisonnières et les périodes de forte/faible affluence autour de cette date. Cite tes sources et propose des boutons pour ajouter les choix retenus.`)
    document.querySelector<HTMLTextAreaElement>('textarea[placeholder]')?.focus()
  }

  const load = useCallback(async () => {
    if (!user) return
    const { data } = await db()
      .from('assistant_messages')
      .select('*')
      .eq('trip_id', trip.id)
      .eq('user_id', user.id)
      .order('created_at')
      .limit(200)
    const list = (data ?? []) as unknown as Message[]
    setMessages(list)
    const paths = list.flatMap((m) => m.images).filter((p) => !urls[p])
    if (paths.length) {
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600)
      setUrls((u) => ({ ...u, ...Object.fromEntries((signed ?? []).filter((s) => s.path && s.signedUrl).map((s) => [s.path!, s.signedUrl as string])) }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, trip.id])

  useEffect(() => {
    void load()
    const ch = supabase
      .channel(`assistant-${trip.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assistant_messages', filter: `trip_id=eq.${trip.id}` }, () => void load())
      .subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [load, trip.id])

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, sending])

  // La reponse arrive : on recharge (au cas ou le temps reel tarde)
  const waiting = jobs.find((j) => j.kind === 'chat' && j.trip_id === trip.id && (j.status === 'pending' || j.status === 'processing'))
  const lastReady = jobs.find((j) => j.kind === 'chat' && j.trip_id === trip.id && j.status !== 'pending' && j.status !== 'processing')?.id
  useEffect(() => {
    if (lastReady) void load()
  }, [lastReady, load])

  function pick(list: FileList | null) {
    if (!list) return
    const room = MAX_PHOTOS - files.length
    const next = [...list].filter((f) => f.type.startsWith('image/')).slice(0, room)
    setFiles((f) => [...f, ...next.map((file) => ({ file, preview: URL.createObjectURL(file) }))])
  }

  async function send() {
    if (!user || (!text.trim() && files.length === 0)) return
    setSending(true)
    setError(null)
    try {
      const paths: string[] = []
      for (const { file } of files) {
        const { file: small } = await compressImage(file)
        const path = `${user.id}/${trip.id}/${crypto.randomUUID()}.jpg`
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, small, { contentType: small.type || 'image/jpeg' })
        if (upErr) throw upErr
        paths.push(path)
      }
      const { data, error: insErr } = await db()
        .from('assistant_messages')
        .insert({ trip_id: trip.id, role: 'user', content: text.trim(), images: paths, status: 'pending' } as never)
        .select()
        .single()
      if (insErr) throw insErr
      await queue('chat', { message_id: (data as unknown as Message).id, lang }, trip.id)
      setText('')
      files.forEach((f) => URL.revokeObjectURL(f.preview))
      setFiles([])
      void load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  async function apply(m: Message, i: number) {
    const a = m.actions[i]
    try {
      if (a.type === 'schedule' && a.place_id) {
        await edit(a.place_id, { visit_date: a.date || null, plan_time: a.time || null, ...(a.minutes ? { plan_minutes: a.minutes } : {}) })
      } else if (a.type === 'add_todo') {
        await hub.addTodo({ title: a.name || a.label, notes: a.notes || null, kind: 'todo', due_at: a.date ? `${a.date}T09:00` : null })
      } else if (a.type === 'add_stay') {
        const stop = hub.stops.find((s) => a.date && s.arrive_date && s.leave_date && s.arrive_date <= a.date && a.date < s.leave_date)
          ?? hub.stops.find((s) => s.name.toLocaleLowerCase() === a.city.toLocaleLowerCase())
        if (!stop) throw new Error(lang === 'fr' ? 'Aucune étape correspondante. Demande d’abord à l’assistant de proposer une étape.' : 'No matching stop. Ask the assistant to suggest a stop first.')
        await hub.editStop(stop.id, {
          stay_name: a.name.slice(0, 120),
          stay_address: a.stay_address || null,
          stay_url: a.stay_url || null,
          notes: [stop.notes, a.notes].filter(Boolean).join('\n\n').slice(0, 3000) || null,
        })
      } else if (a.type === 'add_stop') {
        const leave = a.leave_date || ''
        if (!a.date || !leave || leave <= a.date) throw new Error(lang === 'fr' ? 'Les dates de cette étape sont invalides.' : 'The stop dates are invalid.')
        if ((trip.start_date && a.date < trip.start_date) || (trip.end_date && leave > trip.end_date)) throw new Error(lang === 'fr' ? 'Cette étape sort des dates du voyage.' : 'This stop falls outside the trip dates.')
        const overlaps = hub.stops.some((s) => s.arrive_date && s.leave_date && a.date < s.leave_date && s.arrive_date < leave)
        if (overlaps) throw new Error(lang === 'fr' ? 'Ces dates chevauchent une autre étape. Demande une proposition qui respecte les dates déjà prévues.' : 'These dates overlap another stop. Ask for dates that fit the current itinerary.')
        let { lat, lng } = a
        if (lat == null || lng == null) {
          const hit = (await searchPlaces(`${a.city || a.name} ${a.country}`).catch(() => []))[0]
          ;[lat, lng] = hit ? [hit.lat, hit.lng] : [null, null]
        }
        const orderedStops = [...hub.stops].sort((x, y) => x.position - y.position)
        const position = Math.max(0, orderedStops.findIndex((s) => s.arrive_date && s.arrive_date > a.date) < 0
          ? orderedStops.length
          : orderedStops.findIndex((s) => s.arrive_date && s.arrive_date > a.date))
        for (const existing of orderedStops.slice(position).reverse()) {
          await hub.editStop(existing.id, { position: existing.position + 1 })
        }
        await hub.addStop({
          position,
          name: a.city || a.name,
          country: a.country || null,
          lat,
          lng,
          arrive_date: a.date,
          leave_date: leave,
          stay_name: null,
          stay_address: null,
          stay_ref: null,
          stay_url: null,
          hosts: [],
          transport_mode: null,
          transport_details: null,
          transport_departs: null,
          transport_arrives: null,
          transport_ref: null,
          notes: a.notes || null,
        })
      } else if (a.type === 'add_place') {
        let { lat, lng } = a
        if (lat == null || lng == null) {
          const hit = (await searchPlaces(`${a.name}, ${a.city} ${a.country}`).catch(() => []))[0]
          ;[lat, lng] = hit ? [hit.lat, hit.lng] : [null, null]
        }
        if (lat == null || lng == null) {
          const s = hub.stops.find((x) => x.name.toLowerCase() === a.city.toLowerCase()) ?? hub.stops[0]
          ;[lat, lng] = [s?.lat ?? null, s?.lng ?? null]
        }
        if (lat == null || lng == null) throw new Error(t('chat.noPlace'))
        await add({
          trip_id: trip.id, category_id: null, name: a.name.slice(0, 120), country: a.country, city: a.city || null, lat, lng,
          visit_date: a.date || null, notes: a.notes || null, status: 'wishlist', planned_order: null, cost: null, currency: 'EUR',
          price_level: null, promo_code: null, promo_note: null, promo_until: null, rating: null, review: null,
          plan_time: a.time || null, plan_minutes: a.minutes ?? null,
        })
      }
      const applied = [...(m.applied ?? []), i]
      setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, applied } : x)))
      await db().from('assistant_messages').update({ applied } as never).eq('id', m.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="flex flex-col">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[linear-gradient(140deg,#ffb38a,#ff7f57_50%,#c56fd0)] text-2xl shadow-[var(--shadow-sm)]">
          🧭
        </span>
        <div>
          <p className="text-[1.2rem] font-extrabold">{t('chat.title')}</p>
          <p className="text-[13px] text-text-muted">{t('chat.subtitle')}</p>
        </div>
      </div>

      {planningPrompts.length > 0 && (
        <section className="mb-4 rounded-[22px] border border-accent/25 bg-[var(--halo)] p-4" aria-label={lang === 'fr' ? 'Points à compléter' : 'Planning gaps'}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold">{lang === 'fr' ? 'À compléter dans le voyage' : 'Complete your trip'}</p>
              <p className="mt-1 text-xs text-text-muted">{lang === 'fr' ? 'Journées sans activité, nuits sans logement ou dates sans étape.' : 'Days without activities, nights without a stay, or dates without a stop.'}</p>
            </div>
            <span className="num rounded-full bg-surface px-2.5 py-1 text-xs font-bold">{planningPrompts.length}{planningPrompts.length === 6 ? '+' : ''}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {planningPrompts.map((gap) => (
              <button key={gap.date} onClick={() => askAboutGap(gap)} className="rounded-full border border-line bg-surface px-3 py-2 text-left text-xs font-semibold transition hover:border-accent active:scale-[0.98]">
                {shortDate(gap.date, locale, true)} · {[gap.city && (lang === 'fr' ? 'étape' : 'stop'), gap.stay && (lang === 'fr' ? 'logement' : 'stay'), gap.activity && (lang === 'fr' ? 'activité' : 'activity')].filter(Boolean).join(' + ')}
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="space-y-3 pb-4">
        {messages.length === 0 && (
          <div className="rounded-[22px] border border-dashed border-line-strong p-5 text-[14px] leading-relaxed text-text-muted">
            {t('chat.empty')}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(['chat.ex1', 'chat.ex2', 'chat.ex3'] as const).map((k) => (
                <button key={k} onClick={() => setText(t(k))} className="pill text-[12px]">
                  {t(k)}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`fade-in flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[88%] rounded-[22px] px-4 py-3 text-[15px] leading-relaxed shadow-[var(--shadow-sm)] ${
                m.role === 'user' ? 'rounded-br-md bg-accent text-accent-ink' : 'rounded-bl-md border border-line bg-surface'
              }`}
            >
              {m.images.length > 0 && (
                <div className={`mb-2 grid gap-1.5 ${m.images.length === 1 ? 'grid-cols-1' : 'grid-cols-3'}`}>
                  {m.images.map((p) =>
                    urls[p] ? (
                      <a key={p} href={urls[p]} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-xl bg-black/10">
                        <img src={urls[p]} alt="" className="h-full w-full object-cover" />
                      </a>
                    ) : (
                      <span key={p} className="block aspect-square rounded-xl bg-black/10" />
                    ),
                  )}
                </div>
              )}
              {m.content && <p className="whitespace-pre-wrap">{m.content}</p>}
              {m.actions.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {m.actions.map((a, i) => {
                    const done = (m.applied ?? []).includes(i)
                    return (
                      <button
                        key={i}
                        disabled={done}
                        onClick={() => void apply(m, i)}
                        className={`flex w-full items-center gap-2 rounded-2xl border px-3 py-2 text-left text-[13px] font-semibold transition-all active:scale-[0.98] ${
                          done ? 'border-[var(--color-olive)] bg-[rgba(124,135,103,0.12)]' : 'border-accent/40 bg-[var(--halo)]'
                        }`}
                      >
                        <span>{done ? '✅' : a.type === 'add_todo' ? '📝' : a.type === 'add_stay' ? '🛏️' : a.type === 'schedule' ? '📅' : '📍'}</span>
                        <span className="min-w-0 flex-1">
                          {a.label}
                          {a.date && <span className="block text-[11px] font-normal text-text-muted">{shortDate(a.date, locale, true)}{a.leave_date ? ` – ${shortDate(a.leave_date, locale, true)}` : ''}{a.time && ` · ${a.time}`}</span>}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        ))}
        {waiting && (
          <div className="flex justify-start">
            <div className="w-64 rounded-[22px] rounded-bl-md border border-line bg-surface px-4 py-3">
              <AiGauge job={waiting} compact />
            </div>
          </div>
        )}
        <div ref={bottom} />
      </div>

      {error && <p className="notice notice-bad mb-3">{error}</p>}

      {/* Zone de saisie, collee en bas */}
      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 rounded-[24px] border border-line bg-surface-solid p-2.5 shadow-[var(--shadow-md)] sm:bottom-4">
        {files.length > 0 && (
          <div className="nav-scroll mb-2 flex gap-2 overflow-x-auto">
            {files.map((f, i) => (
              <span key={f.preview} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl">
                <img src={f.preview} alt="" className="h-full w-full object-cover" />
                <button
                  onClick={() => setFiles((list) => list.filter((_, j) => j !== i))}
                  className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-[10px] text-white"
                  aria-label={t('common.erase')}
                >
                  ✕
                </button>
              </span>
            ))}
            <span className="num self-center px-1 text-[12px] text-text-muted">
              {files.length}/{MAX_PHOTOS}
            </span>
          </div>
        )}
        <div className="flex items-end gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={files.length >= MAX_PHOTOS}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xl active:scale-95"
            aria-label={t('chat.photos')}
          >
            📷
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { pick(e.target.files); e.target.value = '' }} />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={1}
            placeholder={t('chat.ph')}
            className="max-h-40 min-h-11 flex-1 resize-none rounded-2xl bg-surface-2 px-3.5 py-2.5 text-[15px] outline-none"
            onInput={(e) => {
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = `${Math.min(160, el.scrollHeight)}px`
            }}
          />
          <button
            onClick={() => void send()}
            disabled={sending || (!text.trim() && files.length === 0)}
            className="btn btn-accent h-11 w-11 shrink-0 rounded-full p-0 text-lg"
            aria-label={t('chat.send')}
          >
            {sending ? <span className="ai-spin inline-block">✨</span> : '↑'}
          </button>
        </div>
      </div>
    </div>
  )
}
