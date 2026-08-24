export type Profile = {
  id: string
  display_name: string | null
  avatar_url: string | null
  created_at: string
}

export type Place = {
  id: string
  user_id: string
  name: string
  country: string
  lat: number
  lng: number
  visit_date: string | null
  notes: string | null
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

export type NewPlace = Omit<Place, 'id' | 'created_at'>

/**
 * Typage minimal pour createClient. Il decrit uniquement ce que l'app utilise,
 * ce qui suffit a typer les select/insert sans generer tout le schema.
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
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
