import type { DocKind, TodoKind, TransportMode } from '../../lib/types'

/**
 * Icones au trait, dessinees a la main pour rester coherentes avec la
 * typographie (trait fin, extremites arrondies). Aucune librairie a charger.
 */
type IconProps = { size?: number; className?: string }

function Svg({ size = 18, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const PlaneIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 13.5 21 6.5c.9-.3 1.4.8.7 1.4L9 18l-1.5-4.5L2.5 13.5Z" />
    <path d="M7.5 13.5 21.3 7.2" />
  </Svg>
)
export const TrainIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="3" width="14" height="14" rx="3" />
    <path d="M5 10h14M9 21l-2-4M15 21l2-4" />
    <circle cx="9" cy="13.5" r=".6" fill="currentColor" />
    <circle cx="15" cy="13.5" r=".6" fill="currentColor" />
  </Svg>
)
export const BusIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="3" width="16" height="15" rx="3" />
    <path d="M4 11h16M7 18v2.5M17 18v2.5M8 7h8" />
  </Svg>
)
export const BoatIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 15h18l-2.5 4.5h-13L3 15Z" />
    <path d="M12 3v12M12 4l6 9H12" />
  </Svg>
)
export const CarIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 16v-4l2-5h12l2 5v4" />
    <path d="M3 16h18v2H3z" />
    <circle cx="7.5" cy="18.5" r="1.5" />
    <circle cx="16.5" cy="18.5" r="1.5" />
  </Svg>
)
export const ScooterIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="6" cy="17" r="3" />
    <circle cx="18" cy="17" r="3" />
    <path d="M6 17h6l3-8h3M15 9l-1-3h-3" />
  </Svg>
)
export const RouteIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="6" cy="18" r="2.5" />
    <circle cx="18" cy="6" r="2.5" />
    <path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5" />
  </Svg>
)
export const BedIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 18V6M3 13h18v5M21 18v-3a3 3 0 0 0-3-3h-7v1" />
    <circle cx="7" cy="10" r="2" />
  </Svg>
)
export const PinIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </Svg>
)
export const CalendarIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="15" rx="3" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Svg>
)
export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
)
export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)
export const ShareIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="9" r="3" />
    <circle cx="16.5" cy="7.5" r="2.5" />
    <path d="M2.5 19.5a5.5 5.5 0 0 1 11 0M13 14.5a5 5 0 0 1 8.5 3.5" />
  </Svg>
)
export const SparkIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7Z" />
    <path d="M19 15.5c.2 1.6.9 2.3 2.5 2.5-1.6.2-2.3.9-2.5 2.5-.2-1.6-.9-2.3-2.5-2.5 1.6-.2 2.3-.9 2.5-2.5Z" />
  </Svg>
)
export const LinkIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Svg>
)
export const FileIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
    <path d="M14 3v5h5" />
  </Svg>
)
export const PassportIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="3" width="14" height="18" rx="2.5" />
    <circle cx="12" cy="10.5" r="3" />
    <path d="M9 10.5h6M12 7.5c-1 1.6-1 4.4 0 6M9 17h6" />
  </Svg>
)
export const ShieldIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 4.5 6v5.5c0 4.4 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5.1 7.5-9.5V6L12 3Z" />
    <path d="m9 12 2 2 4-4" />
  </Svg>
)
export const HeartPulseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19.5 12.6 12 20l-7.5-7.4A4.6 4.6 0 0 1 12 6.6a4.6 4.6 0 0 1 7.5 6Z" />
    <path d="M3.5 12h4l1.5-2.5 2 5 1.5-2.5h3" />
  </Svg>
)
export const WalletIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7.5V18a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-3M4 7.5A2.5 2.5 0 0 1 6.5 5H17v2.5" />
    <path d="M4 7.5h15a1 1 0 0 1 1 1V12h-4a2 2 0 0 0 0 4h4" />
  </Svg>
)
export const StampIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 21h14M6 17h12v-2a2 2 0 0 0-2-2h-2.5V9.5a3 3 0 1 0-3 0V13H8a2 2 0 0 0-2 2v2Z" />
  </Svg>
)
export const SuitcaseIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="7" width="16" height="12" rx="2.5" />
    <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M9 7v12M15 7v12" />
  </Svg>
)
export const TicketIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8a2 2 0 0 0 0 4v4a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-4a2 2 0 0 1 0-4V5a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v3Z" transform="translate(0 1.5)" />
    <path d="M14 5.5v12" strokeDasharray="1.5 2" />
  </Svg>
)
export const ListIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2" />
  </Svg>
)
export const CloudOffIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 18h10a4 4 0 0 0 .7-7.9A6 6 0 0 0 6.1 9.4 4.3 4.3 0 0 0 7 18Z" />
    <path d="m9.5 13 2 2 3.5-3.5" />
  </Svg>
)
export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  </Svg>
)
export const ArrowUpIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Svg>
)
export const ArrowDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Svg>
)
export const ExternalIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </Svg>
)
export const BellIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z" />
    <path d="M10 20a2.2 2.2 0 0 0 4 0" />
  </Svg>
)

export function TransportIcon({ mode, ...p }: IconProps & { mode: TransportMode | null }) {
  switch (mode) {
    case 'plane':
      return <PlaneIcon {...p} />
    case 'train':
      return <TrainIcon {...p} />
    case 'bus':
      return <BusIcon {...p} />
    case 'boat':
      return <BoatIcon {...p} />
    case 'car':
    case 'taxi':
      return <CarIcon {...p} />
    case 'motorbike':
      return <ScooterIcon {...p} />
    default:
      return <RouteIcon {...p} />
  }
}

export function DocIcon({ kind, ...p }: IconProps & { kind: DocKind }) {
  switch (kind) {
    case 'passport':
      return <PassportIcon {...p} />
    case 'visa':
      return <StampIcon {...p} />
    case 'flight':
      return <PlaneIcon {...p} />
    case 'transport':
      return <TicketIcon {...p} />
    case 'stay':
      return <BedIcon {...p} />
    case 'insurance':
      return <ShieldIcon {...p} />
    case 'health':
      return <HeartPulseIcon {...p} />
    case 'money':
      return <WalletIcon {...p} />
    default:
      return <FileIcon {...p} />
  }
}

export function TodoKindIcon({ kind, ...p }: IconProps & { kind: TodoKind }) {
  switch (kind) {
    case 'booking':
      return <TicketIcon {...p} />
    case 'admin':
      return <StampIcon {...p} />
    case 'packing':
      return <SuitcaseIcon {...p} />
    default:
      return <ListIcon {...p} />
  }
}
