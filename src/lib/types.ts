export type Lang = 'fr' | 'en'

export type Profile = {
  id: string
  display_name: string | null
  avatar_url: string | null
  /** Langue de l'interface, liee au compte et non a l'appareil. */
  lang: Lang
  created_at: string
}

export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'

export type TravelEvent = {
  id: string
  user_id: string
  place_id: string | null
  trip_id: string | null
  category_id: string | null
  title: string
  description: string | null
  /** Ce qui aide a reconnaitre l'evenement : concert, marche, festival... */
  kind: string | null
  organizer: string | null
  url: string | null
  starts_at: string
  ends_at: string | null
  all_day: boolean
  recurrence: Recurrence
  recurrence_until: string | null
  price: number | null
  currency: string
  is_free: boolean
  booking_note: string | null
  /** Renseignes seulement si l'evenement n'est pas sur un lieu du carnet. */
  venue: string | null
  lat: number | null
  lng: number | null
  created_at: string
}

export type TripStatus = 'planning' | 'done'

export type ChecklistItem = { id: string; text: string; done: boolean }

export type Trip = {
  id: string
  user_id: string
  title: string
  start_date: string | null
  end_date: string | null
  cover_url: string | null
  notes: string | null
  status: TripStatus
  checklist: ChecklistItem[]
  created_at: string
}

export type Category = {
  id: string
  user_id: string
  name: string
  color: string
  icon: string | null
  created_at: string
}

/** 'visited' alimente le carnet, 'wishlist' alimente la bucketlist. */
export type PlaceStatus = 'visited' | 'wishlist'

export type Place = {
  id: string
  user_id: string
  trip_id: string | null
  category_id: string | null
  name: string
  country: string
  city: string | null
  lat: number
  lng: number
  visit_date: string | null
  notes: string | null
  status: PlaceStatus
  /** Rang de l'etape dans un voyage en preparation. */
  planned_order: number | null
  /** Ce qui a ete depense sur place. Reste prive, jamais partage. */
  cost: number | null
  currency: string
  /** Fourchette de prix, de 1 a 4, facon guides de voyage. */
  price_level: number | null
  promo_code: string | null
  promo_note: string | null
  promo_until: string | null
  /** Note personnelle, de 1 a 5. */
  rating: number | null
  review: string | null
  created_at: string
}

export type Photo = {
  id: string
  place_id: string
  user_id: string
  /** Chemin dans le bucket prive place-photos, pas une URL publique. */
  url: string
  uploaded_at: string
}

export type TrackPoint = { t: number; lat: number; lng: number }

export type Track = {
  id: string
  user_id: string
  trip_id: string | null
  name: string
  points: TrackPoint[]
  distance_km: number
  started_at: string | null
  ended_at: string | null
  notes: string | null
  created_at: string
}

export type PublicShare = {
  user_id: string
  token: string
  is_active: boolean
  created_at: string
}

/* -------------------------------------------------------------------------- */
/* Voyage partage : etapes, a faire, documents                                */
/* -------------------------------------------------------------------------- */

export type TransportMode = 'plane' | 'train' | 'bus' | 'boat' | 'car' | 'taxi' | 'motorbike' | 'other'

/**
 * Une etape de l'itineraire : une ville ou une region ou l'on dort.
 * Les heures de transport sont en heure LOCALE, sans fuseau
 * (« 2026-12-18T10:30:00 »), exactement ce qu'affiche le billet.
 */
export type TripStop = {
  id: string
  trip_id: string
  created_by: string | null
  position: number
  name: string
  country: string | null
  lat: number | null
  lng: number | null
  arrive_date: string | null
  leave_date: string | null
  stay_name: string | null
  stay_address: string | null
  stay_ref: string | null
  stay_url: string | null
  transport_mode: TransportMode | null
  transport_details: string | null
  transport_departs: string | null
  transport_arrives: string | null
  transport_ref: string | null
  notes: string | null
  created_at: string
}

export type TodoKind = 'todo' | 'booking' | 'admin' | 'packing'

export type TripTodo = {
  id: string
  trip_id: string
  stop_id: string | null
  created_by: string | null
  title: string
  notes: string | null
  kind: TodoKind
  /** Heure locale sans fuseau. */
  due_at: string | null
  has_time: boolean
  remind_minutes: number | null
  done: boolean
  done_by: string | null
  position: number
  created_at: string
}

export type DocKind =
  | 'passport'
  | 'visa'
  | 'flight'
  | 'transport'
  | 'stay'
  | 'insurance'
  | 'health'
  | 'money'
  | 'other'

export type TripDocument = {
  id: string
  trip_id: string
  stop_id: string | null
  created_by: string | null
  kind: DocKind
  title: string
  holder: string | null
  reference: string | null
  doc_date: string | null
  valid_until: string | null
  notes: string | null
  /** Chemin dans le bucket prive trip-docs, pas une URL. */
  path: string | null
  file_name: string | null
  mime: string | null
  size_bytes: number | null
  created_at: string
}

export type TripPerson = {
  user_id: string
  display_name: string
  avatar_url: string | null
  is_owner: boolean
}

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export type IdeaStatus = 'pending' | 'processing' | 'ready' | 'error' | 'archived'

/** Resultat de l'analyse d'un lien, ecrit par l'analyseur (worker). */
export type IdeaAnalysis = {
  name: string
  kind: string
  summary: string
  place: {
    name: string
    city: string
    country: string
    address: string
    lat: number | null
    lng: number | null
  }
  price: string
  duration: string
  schedule: string
  booking: string
  booking_url: string
  best_time: string
  tips: string[]
  fit: {
    stop_name: string
    reason: string
    suggested_dates: string[]
  } | null
  transcript_excerpt: string
  sources: { title: string; url: string }[]
}

export type LinkIdea = {
  id: string
  user_id: string
  trip_id: string | null
  url: string
  platform: string | null
  note: string | null
  status: IdeaStatus
  error: string | null
  attempts: number
  title: string | null
  thumbnail: string | null
  analysis: IdeaAnalysis | null
  place_id: string | null
  created_at: string
  updated_at: string
}

export type NewTripStop =Omit<TripStop, 'id' | 'created_at' | 'created_by'>
export type NewTripTodo = Omit<TripTodo, 'id' | 'created_at' | 'created_by'>
export type NewTripDocument = Omit<TripDocument, 'id' | 'created_at' | 'created_by'>

export type NewPlace = Omit<Place, 'id' | 'created_at'>
export type NewTrip = Omit<Trip, 'id' | 'created_at'>
export type NewTrack = Omit<Track, 'id' | 'created_at'>
export type NewCategory = Omit<Category, 'id' | 'created_at'>
export type NewEvent = Omit<TravelEvent, 'id' | 'created_at'>

/**
 * Vues renvoyees par les fonctions de partage, sans user_id ni email.
 * Le montant depense et la devise n'y figurent pas : un visiteur voit la
 * fourchette et l'avis, jamais ce qui a ete paye.
 */
export type SharedPlace = Omit<Place, 'user_id' | 'created_at' | 'cost' | 'currency'>
export type SharedTrip = Omit<Trip, 'user_id' | 'created_at'>
export type SharedPhoto = Pick<Photo, 'id' | 'place_id' | 'url' | 'uploaded_at'>
export type SharedTrack = Omit<Track, 'user_id' | 'created_at'>
export type SharedCategory = Omit<Category, 'user_id' | 'created_at'>
export type SharedEvent = Omit<TravelEvent, 'user_id' | 'created_at' | 'booking_note'>

/**
 * Typage minimal pour createClient. Il decrit uniquement ce que l'app utilise,
 * ce qui suffit a typer les select/insert sans generer tout le schema.
 * Les champs __InternalSupabase et Relationships sont exiges par supabase-js,
 * sans eux les Insert et Update se resolvent en never.
 */
export type Database = {
  __InternalSupabase: { PostgrestVersion: '12' }
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: Partial<Profile> & { id: string }
        Update: Partial<Profile>
        Relationships: []
      }
      trips: {
        Row: Trip
        Insert: NewTrip
        Update: Partial<NewTrip>
        Relationships: []
      }
      tracks: {
        Row: Track
        Insert: NewTrack
        Update: Partial<NewTrack>
        Relationships: []
      }
      events: {
        Row: TravelEvent
        Insert: NewEvent
        Update: Partial<NewEvent>
        Relationships: []
      }
      categories: {
        Row: Category
        Insert: NewCategory
        Update: Partial<NewCategory>
        Relationships: []
      }
      places: {
        Row: Place
        Insert: NewPlace
        Update: Partial<NewPlace>
        Relationships: []
      }
      photos: {
        Row: Photo
        Insert: Omit<Photo, 'id' | 'uploaded_at'>
        Update: Partial<Omit<Photo, 'id' | 'uploaded_at'>>
        Relationships: []
      }
      public_shares: {
        Row: PublicShare
        Insert: Omit<PublicShare, 'created_at'>
        Update: Partial<Omit<PublicShare, 'created_at'>>
        Relationships: []
      }
      trip_stops: {
        Row: TripStop
        Insert: NewTripStop
        Update: Partial<NewTripStop>
        Relationships: []
      }
      trip_todos: {
        Row: TripTodo
        Insert: Partial<NewTripTodo> & Pick<NewTripTodo, 'trip_id' | 'title'>
        Update: Partial<NewTripTodo>
        Relationships: []
      }
      trip_documents: {
        Row: TripDocument
        Insert: Partial<NewTripDocument> & Pick<NewTripDocument, 'trip_id' | 'title' | 'kind'>
        Update: Partial<NewTripDocument>
        Relationships: []
      }
      drafts: {
        Row: {
          id: string
          user_id: string
          key: string
          kind: string
          trip_id: string | null
          title: string | null
          resume_url: string | null
          payload: Json
          remind_at: string | null
          updated_at: string
        }
        Insert: {
          key: string
          kind: string
          trip_id?: string | null
          title?: string | null
          resume_url?: string | null
          payload?: Json
          remind_at?: string | null
          updated_at?: string
        }
        Update: Partial<{
          title: string | null
          payload: Json
          remind_at: string | null
          updated_at: string
        }>
        Relationships: []
      }
      link_ideas: {
        Row: LinkIdea
        Insert: { url: string; platform?: string | null; note?: string | null; trip_id?: string | null }
        Update: Partial<Pick<LinkIdea, 'trip_id' | 'status' | 'place_id' | 'note' | 'attempts' | 'error'>>
        Relationships: []
      }
      ai_jobs: {
        Row: { id: string; user_id: string; trip_id: string | null; kind: string; input: Json; status: string; result: Json | null; error: string | null; attempts: number; created_at: string; updated_at: string }
        Insert: { kind: string; trip_id?: string | null; input: Json }
        Update: { status?: string }
        Relationships: []
      }
      analyzer_status: {
        Row: { id: string; last_seen: string; version: string | null }
        Insert: { id: string; last_seen?: string; version?: string | null }
        Update: { last_seen?: string; version?: string | null }
        Relationships: []
      }
      trip_members: {
        Row: { trip_id: string; user_id: string; added_at: string }
        Insert: { trip_id: string; user_id: string }
        Update: never
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      invite_trip_member: {
        Args: { p_trip: string; p_email: string }
        Returns: string
      }
      trip_people: {
        Args: { p_trip: string }
        Returns: TripPerson[]
      }
      shared_profile: {
        Args: { share_token: string }
        Returns: { display_name: string | null; avatar_url: string | null; lang: Lang }[]
      }
      shared_events: {
        Args: { share_token: string }
        Returns: SharedEvent[]
      }
      shared_places: {
        Args: { share_token: string }
        Returns: SharedPlace[]
      }
      shared_trips: {
        Args: { share_token: string }
        Returns: SharedTrip[]
      }
      shared_photos: {
        Args: { share_token: string }
        Returns: SharedPhoto[]
      }
      shared_tracks: {
        Args: { share_token: string }
        Returns: SharedTrack[]
      }
      shared_categories: {
        Args: { share_token: string }
        Returns: SharedCategory[]
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
