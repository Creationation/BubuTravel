-- ============================================================================
-- BuBuTravel  |  migration 002
-- Voyages, colonne ville, partage public en lecture seule, traces GPS.
-- A coller dans Supabase > SQL Editor > New query > Run, apres schema.sql.
-- Idempotent : peut etre rejoue sans casse.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. VOYAGES
--    Un voyage regroupe plusieurs lieux d'un meme deplacement.
-- ---------------------------------------------------------------------------
create table if not exists public.trips (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  title      text not null,
  start_date date,
  end_date   date,
  cover_url  text,
  notes      text,
  created_at timestamptz not null default now()
);

create index if not exists trips_user_id_idx on public.trips (user_id);
create index if not exists trips_dates_idx   on public.trips (user_id, start_date desc);

alter table public.trips enable row level security;

drop policy if exists "trips: lire les siens"      on public.trips;
drop policy if exists "trips: creer les siens"     on public.trips;
drop policy if exists "trips: modifier les siens"  on public.trips;
drop policy if exists "trips: supprimer les siens" on public.trips;

create policy "trips: lire les siens"
  on public.trips for select using (auth.uid() = user_id);
create policy "trips: creer les siens"
  on public.trips for insert with check (auth.uid() = user_id);
create policy "trips: modifier les siens"
  on public.trips for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "trips: supprimer les siens"
  on public.trips for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2. LIEUX : rattachement a un voyage + ville
--    on delete set null : supprimer un voyage ne supprime pas ses lieux,
--    ils redeviennent simplement des lieux isoles.
-- ---------------------------------------------------------------------------
alter table public.places add column if not exists trip_id uuid
  references public.trips (id) on delete set null;
alter table public.places add column if not exists city text;

create index if not exists places_trip_id_idx on public.places (trip_id);

-- ---------------------------------------------------------------------------
-- 3. PARTAGE PUBLIC EN LECTURE SEULE
--    Un jeton unique par compte. Les visiteurs n'ont pas de compte, donc la
--    lecture passe par des fonctions security definer qui exigent le jeton,
--    plutot que par un assouplissement des policies RLS.
-- ---------------------------------------------------------------------------
create table if not exists public.public_shares (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  token      text not null unique,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists public_shares_token_idx on public.public_shares (token) where is_active;

alter table public.public_shares enable row level security;

drop policy if exists "shares: lire le sien"       on public.public_shares;
drop policy if exists "shares: creer le sien"      on public.public_shares;
drop policy if exists "shares: modifier le sien"   on public.public_shares;
drop policy if exists "shares: supprimer le sien"  on public.public_shares;

create policy "shares: lire le sien"
  on public.public_shares for select using (auth.uid() = user_id);
create policy "shares: creer le sien"
  on public.public_shares for insert with check (auth.uid() = user_id);
create policy "shares: modifier le sien"
  on public.public_shares for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "shares: supprimer le sien"
  on public.public_shares for delete using (auth.uid() = user_id);

-- Resout un jeton vers un compte, uniquement si le partage est actif.
create or replace function public.share_owner(share_token text)
returns uuid
language sql
security definer
stable
set search_path = public
as $function$
  select s.user_id from public.public_shares s
  where s.token = share_token and s.is_active
$function$;

-- Profil public : nom et avatar seulement, jamais l'email.
create or replace function public.shared_profile(share_token text)
returns table (display_name text, avatar_url text)
language sql
security definer
stable
set search_path = public
as $function$
  select p.display_name, p.avatar_url
  from public.profiles p
  where p.id = public.share_owner(share_token)
$function$;

create or replace function public.shared_places(share_token text)
returns table (
  id uuid, name text, country text, city text,
  lat double precision, lng double precision,
  visit_date date, notes text, trip_id uuid
)
language sql
security definer
stable
set search_path = public
as $function$
  select pl.id, pl.name, pl.country, pl.city, pl.lat, pl.lng,
         pl.visit_date, pl.notes, pl.trip_id
  from public.places pl
  where pl.user_id = public.share_owner(share_token)
  order by pl.visit_date desc nulls last
$function$;

create or replace function public.shared_trips(share_token text)
returns table (
  id uuid, title text, start_date date, end_date date, cover_url text, notes text
)
language sql
security definer
stable
set search_path = public
as $function$
  select t.id, t.title, t.start_date, t.end_date, t.cover_url, t.notes
  from public.trips t
  where t.user_id = public.share_owner(share_token)
  order by t.start_date desc nulls last
$function$;

create or replace function public.shared_photos(share_token text)
returns table (id uuid, place_id uuid, url text, uploaded_at timestamptz)
language sql
security definer
stable
set search_path = public
as $function$
  select ph.id, ph.place_id, ph.url, ph.uploaded_at
  from public.photos ph
  where ph.user_id = public.share_owner(share_token)
  order by ph.uploaded_at
$function$;

grant execute on function public.shared_profile(text) to anon;
grant execute on function public.shared_places(text)  to anon;
grant execute on function public.shared_trips(text)   to anon;
grant execute on function public.shared_photos(text)  to anon;
-- share_owner reste interne, appele par les fonctions ci-dessus
revoke execute on function public.share_owner(text) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. STORAGE : lecture des photos d'un compte qui partage
--    Necessaire pour que createSignedUrl fonctionne cote visiteur : le storage
--    ne signe une URL que si l'appelant a le droit de lire l'objet.
--    Le droit disparait des que le partage est desactive.
--    Les chemins restent en uuid, non devinables, et ne sont obtenus que par
--    les fonctions ci-dessus, qui exigent le jeton.
-- ---------------------------------------------------------------------------
drop policy if exists "photos: lire les dossiers partages" on storage.objects;

create policy "photos: lire les dossiers partages"
  on storage.objects for select
  using (
    bucket_id = 'place-photos'
    and exists (
      select 1 from public.public_shares s
      where s.is_active
        and s.user_id::text = (storage.foldername(name))[1]
    )
  );

-- ---------------------------------------------------------------------------
-- 5. TRACES GPS
--    Enregistrement d'un parcours, randonnee ou trajet, entre deux points.
--    Les points sont stockes en jsonb : [{ "t": epoch_ms, "lat": x, "lng": y }]
--    Un tableau suffit largement ici, et evite d'installer PostGIS.
-- ---------------------------------------------------------------------------
create table if not exists public.tracks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  trip_id     uuid references public.trips (id) on delete set null,
  name        text not null,
  points      jsonb not null default '[]'::jsonb,
  distance_km double precision not null default 0,
  started_at  timestamptz,
  ended_at    timestamptz,
  notes       text,
  created_at  timestamptz not null default now()
);

create index if not exists tracks_user_id_idx on public.tracks (user_id);
create index if not exists tracks_trip_id_idx on public.tracks (trip_id);

alter table public.tracks enable row level security;

drop policy if exists "tracks: lire les siennes"      on public.tracks;
drop policy if exists "tracks: creer les siennes"     on public.tracks;
drop policy if exists "tracks: modifier les siennes"  on public.tracks;
drop policy if exists "tracks: supprimer les siennes" on public.tracks;

create policy "tracks: lire les siennes"
  on public.tracks for select using (auth.uid() = user_id);
create policy "tracks: creer les siennes"
  on public.tracks for insert with check (auth.uid() = user_id);
create policy "tracks: modifier les siennes"
  on public.tracks for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tracks: supprimer les siennes"
  on public.tracks for delete using (auth.uid() = user_id);

-- Traces visibles depuis un lien de partage
create or replace function public.shared_tracks(share_token text)
returns table (
  id uuid, trip_id uuid, name text, points jsonb,
  distance_km double precision, started_at timestamptz, ended_at timestamptz, notes text
)
language sql
security definer
stable
set search_path = public
as $function$
  select t.id, t.trip_id, t.name, t.points, t.distance_km, t.started_at, t.ended_at, t.notes
  from public.tracks t
  where t.user_id = public.share_owner(share_token)
  order by t.started_at desc nulls last
$function$;

grant execute on function public.shared_tracks(text) to anon;
