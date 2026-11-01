import type { Trip, TripStop, TripTodo, TransportMode } from './types'

/**
 * Export calendrier (.ics) d'un voyage : etapes, transports et a faire, avec
 * alarmes. Le fichier s'ouvre dans Google Agenda, Apple Calendrier ou
 * Outlook, et c'est le telephone qui sonne, meme sans reseau.
 *
 * Les heures sont « flottantes » (sans fuseau, sans Z) : un vol a 10 h 30 a
 * Bangkok s'affiche a 10 h 30 sur un telephone regle a l'heure locale, ce que
 * font les telephones automatiquement en arrivant dans le pays.
 *
 * Chaque evenement a un UID stable : reimporter le fichier apres une
 * modification met a jour les evenements au lieu de les dupliquer.
 */

export type IcsLabels = {
  stay: string
  transport: Record<TransportMode, string>
  reference: string
  todo: string
}

const CRLF = '\r\n'

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** RFC 5545 : lignes de 75 octets maximum, suite precedee d'un espace. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line
  const parts: string[] = []
  let current = ''
  let size = 0
  for (const char of line) {
    const len = new TextEncoder().encode(char).length
    if (size + len > (parts.length === 0 ? 75 : 74)) {
      parts.push(current)
      current = ''
      size = 0
    }
    current += char
    size += len
  }
  parts.push(current)
  return parts.join(`${CRLF} `)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** « 2026-12-13 » -> « 20261213 » */
function icsDate(date: string): string {
  return date.slice(0, 10).replace(/-/g, '')
}

/** « 2026-12-13T10:30:00 » -> « 20261213T103000 » (heure flottante) */
function icsLocal(dateTime: string): string {
  const [d, t = '00:00:00'] = dateTime.split('T')
  const [hh = '00', mm = '00', ss = '00'] = t.split(':')
  return `${icsDate(d)}T${hh}${mm}${ss.slice(0, 2)}`
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date.slice(0, 10)}T12:00:00`)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function addMinutes(dateTime: string, minutes: number): string {
  const d = new Date(dateTime.length === 16 ? `${dateTime}:00` : dateTime)
  d.setMinutes(d.getMinutes() + minutes)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}:00`
}

function stamp(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(
    d.getUTCHours(),
  )}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

function alarm(minutesBefore: number, description: string): string[] {
  return [
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(description)}`,
    `TRIGGER:-PT${Math.max(0, Math.round(minutesBefore))}M`,
    'END:VALARM',
  ]
}

export function buildTripIcs(
  trip: Trip,
  stops: TripStop[],
  todos: TripTodo[],
  labels: IcsLabels,
): string {
  const now = stamp()
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BuBuTravel//Voyage//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(trip.title)}`,
  ]

  const ordered = [...stops].sort((a, b) => a.position - b.position)

  ordered.forEach((stop, i) => {
    // Sejour : evenement sur toute la journee, de l'arrivee au depart
    if (stop.arrive_date) {
      const end = stop.leave_date && stop.leave_date > stop.arrive_date ? stop.leave_date : addDays(stop.arrive_date, 1)
      const desc = [
        stop.stay_name && `${labels.stay} : ${stop.stay_name}`,
        stop.stay_address,
        stop.stay_ref && `${labels.reference} : ${stop.stay_ref}`,
        stop.notes,
      ]
        .filter(Boolean)
        .join('\n')
      lines.push(
        'BEGIN:VEVENT',
        `UID:stop-${stop.id}@bubutravel`,
        `DTSTAMP:${now}`,
        `DTSTART;VALUE=DATE:${icsDate(stop.arrive_date)}`,
        `DTEND;VALUE=DATE:${icsDate(end)}`,
        `SUMMARY:${escapeText(stop.country ? `${stop.name} (${stop.country})` : stop.name)}`,
        ...(desc ? [`DESCRIPTION:${escapeText(desc)}`] : []),
        ...(stop.stay_address ? [`LOCATION:${escapeText(stop.stay_address)}`] : []),
        'TRANSP:TRANSPARENT',
        'END:VEVENT',
      )
    }

    // Transport vers l'etape suivante : alarmes la veille et 3 h avant
    if (stop.transport_departs) {
      const next = ordered[i + 1]
      const mode = stop.transport_mode ?? 'other'
      const title = `${labels.transport[mode]} : ${stop.name}${next ? ` → ${next.name}` : ''}`
      const end =
        stop.transport_arrives && stop.transport_arrives > stop.transport_departs
          ? stop.transport_arrives
          : addMinutes(stop.transport_departs, 120)
      const desc = [
        stop.transport_details,
        stop.transport_ref && `${labels.reference} : ${stop.transport_ref}`,
      ]
        .filter(Boolean)
        .join('\n')
      lines.push(
        'BEGIN:VEVENT',
        `UID:transport-${stop.id}@bubutravel`,
        `DTSTAMP:${now}`,
        `DTSTART:${icsLocal(stop.transport_departs)}`,
        `DTEND:${icsLocal(end)}`,
        `SUMMARY:${escapeText(title)}`,
        ...(desc ? [`DESCRIPTION:${escapeText(desc)}`] : []),
        ...alarm(24 * 60, title),
        ...alarm(3 * 60, title),
        'END:VEVENT',
      )
    }
  })

  for (const todo of todos) {
    if (todo.done || !todo.due_at) continue
    const title = `${labels.todo} : ${todo.title}`
    const common = [
      'BEGIN:VEVENT',
      `UID:todo-${todo.id}@bubutravel`,
      `DTSTAMP:${now}`,
      `SUMMARY:${escapeText(title)}`,
      ...(todo.notes ? [`DESCRIPTION:${escapeText(todo.notes)}`] : []),
    ]
    if (todo.has_time) {
      lines.push(
        ...common,
        `DTSTART:${icsLocal(todo.due_at)}`,
        `DTEND:${icsLocal(addMinutes(todo.due_at, 30))}`,
        ...alarm(todo.remind_minutes ?? 60, title),
        'END:VEVENT',
      )
    } else {
      // Sans heure : journee entiere, rappel la veille a 9 h par defaut
      // (minuit moins 15 h), ou selon le delai choisi.
      lines.push(
        ...common,
        `DTSTART;VALUE=DATE:${icsDate(todo.due_at)}`,
        `DTEND;VALUE=DATE:${icsDate(addDays(todo.due_at, 1))}`,
        'TRANSP:TRANSPARENT',
        ...alarm(todo.remind_minutes ?? 15 * 60, title),
        'END:VEVENT',
      )
    }
  }

  lines.push('END:VCALENDAR')
  return lines.map(fold).join(CRLF) + CRLF
}

export function downloadIcs(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.ics') ? filename : `${filename}.ics`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
