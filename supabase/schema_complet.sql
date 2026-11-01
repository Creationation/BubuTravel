-- ============================================================================
-- BuBuTravel  |  SCHEMA COMPLET
--
-- Ce fichier contient TOUT : la base et chaque migration, dans l'ordre.
-- Il est entierement idempotent, il peut etre execute autant de fois qu'on
-- veut, sur une base vierge comme sur une base deja a jour. C'est le seul
-- fichier a coller dans Supabase > SQL Editor > New query > Run.
--
-- Genere par scripts/build-schema.mjs, ne pas modifier a la main :
-- editez supabase/schema.sql ou une migration, puis relancez le script.
-- ============================================================================



-- ####################################################################
-- ## Base : profils, lieux, photos, RLS, buckets, trigger
-- ## source : supabase/schema.sql
-- ####################################################################

-- ============================================================================
-- BuBuTravel  |  schema complet v1
-- A coller dans Supabase > SQL Editor > New query > Run
-- Idempotent : peut etre rejoue sans casse.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. PROFILS
--    Une ligne par compte auth. Cree automatiquement par le trigger plus bas.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: lire le sien"     on public.profiles;
drop policy if exists "profiles: creer le sien"    on public.profiles;
drop policy if exists "profiles: modifier le sien" on public.profiles;

create policy "profiles: lire le sien"
  on public.profiles for select using (auth.uid() = id);
create policy "profiles: creer le sien"
  on public.profiles for insert with check (auth.uid() = id);
create policy "profiles: modifier le sien"
  on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- 2. LIEUX VISITES
-- ---------------------------------------------------------------------------
create table if not exists public.places (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  country    text not null,
  lat        double precision not null,
  lng        double precision not null,
  visit_date date,
  notes      text,
  created_at timestamptz not null default now()
);

create index if not exists places_user_id_idx    on public.places (user_id);
create index if not exists places_visit_date_idx on public.places (user_id, visit_date desc);

alter table public.places enable row level security;

drop policy if exists "places: lire les siens"      on public.places;
drop policy if exists "places: creer les siens"     on public.places;
drop policy if exists "places: modifier les siens"  on public.places;
drop policy if exists "places: supprimer les siens" on public.places;

create policy "places: lire les siens"
  on public.places for select using (auth.uid() = user_id);
create policy "places: creer les siens"
  on public.places for insert with check (auth.uid() = user_id);
create policy "places: modifier les siens"
  on public.places for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "places: supprimer les siens"
  on public.places for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. PHOTOS
--    La colonne url contient le CHEMIN dans le bucket prive place-photos
--    (format : {user_id}/{place_id}/{uuid}.{ext}), pas une URL publique.
--    L'app genere une URL signee au moment de l'affichage.
-- ---------------------------------------------------------------------------
create table if not exists public.photos (
  id          uuid primary key default gen_random_uuid(),
  place_id    uuid not null references public.places (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  url         text not null,
  uploaded_at timestamptz not null default now()
);

create index if not exists photos_place_id_idx on public.photos (place_id);
create index if not exists photos_user_id_idx  on public.photos (user_id);

alter table public.photos enable row level security;

drop policy if exists "photos: lire les siennes"      on public.photos;
drop policy if exists "photos: creer les siennes"     on public.photos;
drop policy if exists "photos: supprimer les siennes" on public.photos;

create policy "photos: lire les siennes"
  on public.photos for select using (auth.uid() = user_id);
create policy "photos: creer les siennes"
  on public.photos for insert with check (auth.uid() = user_id);
create policy "photos: supprimer les siennes"
  on public.photos for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 4. TRIGGER : creer le profil a l'inscription
--    A appliquer AVANT de creer les comptes, sinon les comptes existants
--    n'ont pas de ligne profiles et l'app plante apres le login.
--    Le backfill juste en dessous rattrape ce cas.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill des comptes crees avant ce trigger
insert into public.profiles (id, display_name)
select u.id, coalesce(u.raw_user_meta_data ->> 'display_name', split_part(u.email, '@', 1))
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- ---------------------------------------------------------------------------
-- 5. STORAGE
--    avatars      : lecture publique (photo de profil)
--    place-photos : prive, lecture via URL signee uniquement
--    Dans les deux cas le premier dossier du chemin doit etre l'uuid du user.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

insert into storage.buckets (id, name, public)
values ('place-photos', 'place-photos', false)
on conflict (id) do update set public = false;

drop policy if exists "avatars: lecture publique"     on storage.objects;
drop policy if exists "avatars: ecrire son dossier"   on storage.objects;
drop policy if exists "avatars: modifier son dossier" on storage.objects;
drop policy if exists "avatars: vider son dossier"    on storage.objects;
drop policy if exists "photos: lire son dossier"      on storage.objects;
drop policy if exists "photos: ecrire son dossier"    on storage.objects;
drop policy if exists "photos: vider son dossier"     on storage.objects;

create policy "avatars: lecture publique"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars: ecrire son dossier"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars: modifier son dossier"
  on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars: vider son dossier"
  on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "photos: lire son dossier"
  on storage.objects for select
  using (bucket_id = 'place-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "photos: ecrire son dossier"
  on storage.objects for insert
  with check (bucket_id = 'place-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "photos: vider son dossier"
  on storage.objects for delete
  using (bucket_id = 'place-photos' and (storage.foldername(name))[1] = auth.uid()::text);


-- ####################################################################
-- ## Migration 002_trips_gallery_sharing
-- ## source : supabase\migrations\002_trips_gallery_sharing.sql
-- ####################################################################

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


-- ####################################################################
-- ## Migration 003_lock_share_owner
-- ## source : supabase\migrations\003_lock_share_owner.sql
-- ####################################################################

-- ============================================================================
-- BuBuTravel  |  migration 003
-- Verrouille share_owner, qui restait appelable par les visiteurs.
-- ============================================================================

-- Postgres accorde EXECUTE a PUBLIC sur toute fonction nouvellement creee.
-- La migration 002 revoquait le droit a anon et authenticated, mais ces roles
-- l'heritaient encore de PUBLIC : la fonction restait appelable et revelait
-- l'uuid du proprietaire a qui possedait un jeton. Il faut revoquer PUBLIC.
revoke execute on function public.share_owner(text) from public;
revoke execute on function public.share_owner(text) from anon, authenticated;

-- Les fonctions de lecture partagee gardent leur acces explicite. Elles sont
-- security definer, donc leur appel interne a share_owner passe toujours.
grant execute on function public.shared_profile(text) to anon, authenticated;
grant execute on function public.shared_places(text)  to anon, authenticated;
grant execute on function public.shared_trips(text)   to anon, authenticated;
grant execute on function public.shared_photos(text)  to anon, authenticated;
grant execute on function public.shared_tracks(text)  to anon, authenticated;


-- ####################################################################
-- ## Migration 004_bucketlist_categories_planner
-- ## source : supabase\migrations\004_bucketlist_categories_planner.sql
-- ####################################################################

-- ============================================================================
-- BuBuTravel  |  migration 004
-- Bucketlist (lieux a visiter), categories personnalisables, planificateur.
-- A coller dans Supabase > SQL Editor > New query > Run.
-- Idempotent : peut etre rejoue sans casse.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. CATEGORIES
--    Entierement libres : chacun cree, renomme et supprime les siennes.
-- ---------------------------------------------------------------------------
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  color      text not null default '#c4653d',
  icon       text,
  created_at timestamptz not null default now()
);

create index if not exists categories_user_id_idx on public.categories (user_id);

-- Deux categories du meme nom pour un meme compte n'ont aucun sens
create unique index if not exists categories_user_name_key
  on public.categories (user_id, lower(name));

alter table public.categories enable row level security;

drop policy if exists "categories: lire les siennes"      on public.categories;
drop policy if exists "categories: creer les siennes"     on public.categories;
drop policy if exists "categories: modifier les siennes"  on public.categories;
drop policy if exists "categories: supprimer les siennes" on public.categories;

create policy "categories: lire les siennes"
  on public.categories for select using (auth.uid() = user_id);
create policy "categories: creer les siennes"
  on public.categories for insert with check (auth.uid() = user_id);
create policy "categories: modifier les siennes"
  on public.categories for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "categories: supprimer les siennes"
  on public.categories for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2. LIEUX : statut, categorie, ordre dans un plan
--    status = 'visited' pour le carnet, 'wishlist' pour la bucketlist.
--    Les lignes existantes sont toutes des lieux deja visites.
--    Supprimer une categorie ne supprime pas les lieux, ils la perdent.
-- ---------------------------------------------------------------------------
alter table public.places add column if not exists status text not null default 'visited';
alter table public.places add column if not exists category_id uuid
  references public.categories (id) on delete set null;
alter table public.places add column if not exists planned_order integer;

do $do$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'places_status_check'
  ) then
    alter table public.places
      add constraint places_status_check check (status in ('visited', 'wishlist'));
  end if;
end
$do$;

create index if not exists places_status_idx      on public.places (user_id, status);
create index if not exists places_category_id_idx on public.places (category_id);

-- ---------------------------------------------------------------------------
-- 3. VOYAGES : etat et pense-bete
--    status = 'planning' pour un voyage a venir, 'done' pour un voyage passe.
--    checklist : [{ "id": "...", "text": "...", "done": false }]
-- ---------------------------------------------------------------------------
alter table public.trips add column if not exists status text not null default 'done';
alter table public.trips add column if not exists checklist jsonb not null default '[]'::jsonb;

do $do$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'trips_status_check'
  ) then
    alter table public.trips
      add constraint trips_status_check check (status in ('planning', 'done'));
  end if;
end
$do$;

create index if not exists trips_status_idx on public.trips (user_id, status);

-- ---------------------------------------------------------------------------
-- 4. PARTAGE : les nouvelles colonnes doivent suivre
--    create or replace ne suffit pas quand la signature de sortie change,
--    il faut supprimer d'abord.
-- ---------------------------------------------------------------------------
drop function if exists public.shared_places(text);
drop function if exists public.shared_trips(text);

create function public.shared_places(share_token text)
returns table (
  id uuid, name text, country text, city text,
  lat double precision, lng double precision,
  visit_date date, notes text, trip_id uuid,
  status text, category_id uuid, planned_order integer
)
language sql
security definer
stable
set search_path = public
as $function$
  select pl.id, pl.name, pl.country, pl.city, pl.lat, pl.lng,
         pl.visit_date, pl.notes, pl.trip_id,
         pl.status, pl.category_id, pl.planned_order
  from public.places pl
  where pl.user_id = public.share_owner(share_token)
  order by pl.visit_date desc nulls last
$function$;

create function public.shared_trips(share_token text)
returns table (
  id uuid, title text, start_date date, end_date date,
  cover_url text, notes text, status text
)
language sql
security definer
stable
set search_path = public
as $function$
  select t.id, t.title, t.start_date, t.end_date, t.cover_url, t.notes, t.status
  from public.trips t
  where t.user_id = public.share_owner(share_token)
  order by t.start_date desc nulls last
$function$;

-- Categories visibles depuis un lien de partage, pour colorer les lieux
create or replace function public.shared_categories(share_token text)
returns table (id uuid, name text, color text, icon text)
language sql
security definer
stable
set search_path = public
as $function$
  select c.id, c.name, c.color, c.icon
  from public.categories c
  where c.user_id = public.share_owner(share_token)
  order by c.name
$function$;

grant execute on function public.shared_places(share_token text)     to anon, authenticated;
grant execute on function public.shared_trips(share_token text)      to anon, authenticated;
grant execute on function public.shared_categories(share_token text) to anon, authenticated;

-- Les fonctions recreees repartent avec EXECUTE accorde a PUBLIC, ce qui n'est
-- pas voulu ici : seul anon et authenticated doivent pouvoir les appeler.
revoke execute on function public.shared_places(share_token text)     from public;
revoke execute on function public.shared_trips(share_token text)      from public;
revoke execute on function public.shared_categories(share_token text) from public;


-- ####################################################################
-- ## Migration 005_prix_promos_avis
-- ## source : supabase\migrations\005_prix_promos_avis.sql
-- ####################################################################

-- ============================================================================
-- BuBuTravel  |  migration 005
-- Ce que le lieu a coute, sa fourchette de prix, les promotions, et l'avis.
-- A coller dans Supabase > SQL Editor > New query > Run.
-- Idempotent : peut etre rejoue sans casse.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. LIEUX : argent et avis
--    cost en numeric et non en float : un montant ne doit pas subir les
--    arrondis du binaire, 0.1 + 0.2 ne fait pas 0.3 en double precision.
-- ---------------------------------------------------------------------------
alter table public.places add column if not exists cost numeric(12, 2);
alter table public.places add column if not exists currency text not null default 'EUR';
alter table public.places add column if not exists price_level smallint;
alter table public.places add column if not exists promo_code text;
alter table public.places add column if not exists promo_note text;
alter table public.places add column if not exists promo_until date;
alter table public.places add column if not exists rating smallint;
alter table public.places add column if not exists review text;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'places_price_level_check') then
    alter table public.places
      add constraint places_price_level_check
      check (price_level is null or price_level between 1 and 4);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'places_rating_check') then
    alter table public.places
      add constraint places_rating_check
      check (rating is null or rating between 1 and 5);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'places_cost_check') then
    alter table public.places
      add constraint places_cost_check check (cost is null or cost >= 0);
  end if;
end
$do$;

create index if not exists places_rating_idx on public.places (user_id, rating desc nulls last);

-- ---------------------------------------------------------------------------
-- 2. PARTAGE : exposer les nouvelles colonnes
--    La signature de sortie change, il faut supprimer avant de recreer.
--    Le montant depense reste PRIVE : un visiteur voit la fourchette, l'avis
--    et la promotion, jamais ce qui a ete paye.
-- ---------------------------------------------------------------------------
drop function if exists public.shared_places(text);

create function public.shared_places(share_token text)
returns table (
  id uuid, name text, country text, city text,
  lat double precision, lng double precision,
  visit_date date, notes text, trip_id uuid,
  status text, category_id uuid, planned_order integer,
  price_level smallint, rating smallint, review text,
  promo_note text, promo_code text, promo_until date
)
language sql
security definer
stable
set search_path = public
as $function$
  select pl.id, pl.name, pl.country, pl.city, pl.lat, pl.lng,
         pl.visit_date, pl.notes, pl.trip_id,
         pl.status, pl.category_id, pl.planned_order,
         pl.price_level, pl.rating, pl.review,
         pl.promo_note, pl.promo_code, pl.promo_until
  from public.places pl
  where pl.user_id = public.share_owner(share_token)
  order by pl.visit_date desc nulls last
$function$;

grant execute on function public.shared_places(share_token text) to anon, authenticated;
-- Une fonction recreee repart avec EXECUTE accorde a PUBLIC, ce qui n'est pas
-- voulu : seuls anon et authenticated doivent pouvoir l'appeler.
revoke execute on function public.shared_places(share_token text) from public;


-- ####################################################################
-- ## Migration 006_evenements_et_langue
-- ## source : supabase\migrations\006_evenements_et_langue.sql
-- ####################################################################

-- ============================================================================
-- BuBuTravel  |  migration 006
-- Evenements (dates, recurrence, prix, lieu) et langue de l'interface.
-- A coller dans Supabase > SQL Editor > New query > Run.
-- Idempotent : peut etre rejoue sans casse.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. LANGUE
--    Liee au compte et non a l'appareil : le carnet se lit dans la meme
--    langue depuis le telephone et depuis l'ordinateur.
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists lang text not null default 'fr';

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_lang_check') then
    alter table public.profiles
      add constraint profiles_lang_check check (lang in ('fr', 'en'));
  end if;
end
$do$;

-- ---------------------------------------------------------------------------
-- 2. EVENEMENTS
--    Un evenement peut etre rattache a un lieu, ou porter ses propres
--    coordonnees quand il se tient ailleurs. starts_at est un timestamptz :
--    un concert a une heure, pas seulement une date.
-- ---------------------------------------------------------------------------
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  place_id    uuid references public.places (id) on delete set null,
  trip_id     uuid references public.trips (id) on delete set null,
  category_id uuid references public.categories (id) on delete set null,

  title       text not null,
  description text,
  /** Ce qui aide a reconnaitre l'evenement : concert, marche, festival... */
  kind        text,
  organizer   text,
  url         text,

  starts_at   timestamptz not null,
  ends_at     timestamptz,
  all_day     boolean not null default false,
  /** none, daily, weekly, monthly, yearly */
  recurrence  text not null default 'none',
  recurrence_until date,

  price       numeric(12, 2),
  currency    text not null default 'EUR',
  is_free     boolean not null default false,
  booking_note text,

  /** Renseignes seulement si l'evenement n'est pas sur un lieu du carnet. */
  venue       text,
  lat         double precision,
  lng         double precision,

  created_at  timestamptz not null default now()
);

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'events_recurrence_check') then
    alter table public.events
      add constraint events_recurrence_check
      check (recurrence in ('none', 'daily', 'weekly', 'monthly', 'yearly'));
  end if;

  -- Un evenement qui finit avant de commencer n'a pas de sens
  if not exists (select 1 from pg_constraint where conname = 'events_dates_check') then
    alter table public.events
      add constraint events_dates_check check (ends_at is null or ends_at >= starts_at);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'events_price_check') then
    alter table public.events
      add constraint events_price_check check (price is null or price >= 0);
  end if;
end
$do$;

create index if not exists events_user_id_idx  on public.events (user_id);
create index if not exists events_starts_idx   on public.events (user_id, starts_at);
create index if not exists events_place_id_idx on public.events (place_id);
create index if not exists events_trip_id_idx  on public.events (trip_id);

alter table public.events enable row level security;

drop policy if exists "events: lire les siens"      on public.events;
drop policy if exists "events: creer les siens"     on public.events;
drop policy if exists "events: modifier les siens"  on public.events;
drop policy if exists "events: supprimer les siens" on public.events;

create policy "events: lire les siens"
  on public.events for select using (auth.uid() = user_id);
create policy "events: creer les siens"
  on public.events for insert with check (auth.uid() = user_id);
create policy "events: modifier les siens"
  on public.events for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "events: supprimer les siens"
  on public.events for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. PARTAGE
--    Les evenements sont visibles depuis un lien de partage, sans les notes
--    de reservation qui sont personnelles.
-- ---------------------------------------------------------------------------
create or replace function public.shared_events(share_token text)
returns table (
  id uuid, place_id uuid, trip_id uuid, category_id uuid,
  title text, description text, kind text, organizer text, url text,
  starts_at timestamptz, ends_at timestamptz, all_day boolean,
  recurrence text, recurrence_until date,
  price numeric, currency text, is_free boolean,
  venue text, lat double precision, lng double precision
)
language sql
security definer
stable
set search_path = public
as $function$
  select e.id, e.place_id, e.trip_id, e.category_id,
         e.title, e.description, e.kind, e.organizer, e.url,
         e.starts_at, e.ends_at, e.all_day,
         e.recurrence, e.recurrence_until,
         e.price, e.currency, e.is_free,
         e.venue, e.lat, e.lng
  from public.events e
  where e.user_id = public.share_owner(share_token)
  order by e.starts_at
$function$;

grant execute on function public.shared_events(share_token text) to anon, authenticated;
revoke execute on function public.shared_events(share_token text) from public;

-- Le profil partage expose aussi la langue, pour afficher la page publique
-- dans la langue de son proprietaire.
drop function if exists public.shared_profile(text);

create function public.shared_profile(share_token text)
returns table (display_name text, avatar_url text, lang text)
language sql
security definer
stable
set search_path = public
as $function$
  select p.display_name, p.avatar_url, p.lang
  from public.profiles p
  where p.id = public.share_owner(share_token)
$function$;

grant execute on function public.shared_profile(share_token text) to anon, authenticated;
revoke execute on function public.shared_profile(share_token text) from public;


-- ####################################################################
-- ## Migration 007_rattrapage_005_006
-- ## source : supabase\migrations\007_rattrapage_005_006.sql
-- ####################################################################

-- ============================================================================
-- BuBuTravel  |  rattrapage compact des migrations 005 et 006
--
-- Meme contenu que 005 et 006, ecrit court pour pouvoir etre saisi d'un bloc.
-- Idempotent : rejouable sans casse, et sans effet si tout est deja en place.
-- ============================================================================

-- Prix, promotions, avis
alter table public.places add column if not exists cost numeric(12,2);
alter table public.places add column if not exists currency text not null default 'EUR';
alter table public.places add column if not exists price_level smallint;
alter table public.places add column if not exists promo_code text;
alter table public.places add column if not exists promo_note text;
alter table public.places add column if not exists promo_until date;
alter table public.places add column if not exists rating smallint;
alter table public.places add column if not exists review text;

-- Langue de l'interface, liee au compte
alter table public.profiles add column if not exists lang text not null default 'fr';

do $do$
begin
  if not exists (select 1 from pg_constraint where conname='places_price_level_check') then
    alter table public.places add constraint places_price_level_check
      check (price_level is null or price_level between 1 and 4);
  end if;
  if not exists (select 1 from pg_constraint where conname='places_rating_check') then
    alter table public.places add constraint places_rating_check
      check (rating is null or rating between 1 and 5);
  end if;
  if not exists (select 1 from pg_constraint where conname='places_cost_check') then
    alter table public.places add constraint places_cost_check
      check (cost is null or cost >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='profiles_lang_check') then
    alter table public.profiles add constraint profiles_lang_check
      check (lang in ('fr','en'));
  end if;
end
$do$;

-- Evenements
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  place_id uuid references public.places (id) on delete set null,
  trip_id uuid references public.trips (id) on delete set null,
  category_id uuid references public.categories (id) on delete set null,
  title text not null,
  description text,
  kind text,
  organizer text,
  url text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  recurrence text not null default 'none',
  recurrence_until date,
  price numeric(12,2),
  currency text not null default 'EUR',
  is_free boolean not null default false,
  booking_note text,
  venue text,
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now()
);

do $do$
begin
  if not exists (select 1 from pg_constraint where conname='events_recurrence_check') then
    alter table public.events add constraint events_recurrence_check
      check (recurrence in ('none','daily','weekly','monthly','yearly'));
  end if;
  if not exists (select 1 from pg_constraint where conname='events_dates_check') then
    alter table public.events add constraint events_dates_check
      check (ends_at is null or ends_at >= starts_at);
  end if;
end
$do$;

create index if not exists events_user_id_idx on public.events (user_id);
create index if not exists events_starts_idx on public.events (user_id, starts_at);

alter table public.events enable row level security;

drop policy if exists "events: lire les siens" on public.events;
drop policy if exists "events: creer les siens" on public.events;
drop policy if exists "events: modifier les siens" on public.events;
drop policy if exists "events: supprimer les siens" on public.events;

create policy "events: lire les siens" on public.events
  for select using (auth.uid() = user_id);
create policy "events: creer les siens" on public.events
  for insert with check (auth.uid() = user_id);
create policy "events: modifier les siens" on public.events
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "events: supprimer les siens" on public.events
  for delete using (auth.uid() = user_id);

-- Partage : le montant depense reste prive, la fourchette et l'avis sont vus
drop function if exists public.shared_places(text);
create function public.shared_places(share_token text)
returns table (id uuid, name text, country text, city text, lat double precision,
  lng double precision, visit_date date, notes text, trip_id uuid, status text,
  category_id uuid, planned_order integer, price_level smallint, rating smallint,
  review text, promo_note text, promo_code text, promo_until date)
language sql security definer stable set search_path = public as $f$
  select pl.id, pl.name, pl.country, pl.city, pl.lat, pl.lng, pl.visit_date,
         pl.notes, pl.trip_id, pl.status, pl.category_id, pl.planned_order,
         pl.price_level, pl.rating, pl.review, pl.promo_note, pl.promo_code, pl.promo_until
  from public.places pl
  where pl.user_id = public.share_owner(share_token)
  order by pl.visit_date desc nulls last
$f$;

drop function if exists public.shared_profile(text);
create function public.shared_profile(share_token text)
returns table (display_name text, avatar_url text, lang text)
language sql security definer stable set search_path = public as $f$
  select p.display_name, p.avatar_url, p.lang
  from public.profiles p
  where p.id = public.share_owner(share_token)
$f$;

create or replace function public.shared_events(share_token text)
returns table (id uuid, place_id uuid, trip_id uuid, category_id uuid, title text,
  description text, kind text, organizer text, url text, starts_at timestamptz,
  ends_at timestamptz, all_day boolean, recurrence text, recurrence_until date,
  price numeric, currency text, is_free boolean, venue text,
  lat double precision, lng double precision)
language sql security definer stable set search_path = public as $f$
  select e.id, e.place_id, e.trip_id, e.category_id, e.title, e.description, e.kind,
         e.organizer, e.url, e.starts_at, e.ends_at, e.all_day, e.recurrence,
         e.recurrence_until, e.price, e.currency, e.is_free, e.venue, e.lat, e.lng
  from public.events e
  where e.user_id = public.share_owner(share_token)
  order by e.starts_at
$f$;

grant execute on function public.shared_places(text) to anon, authenticated;
grant execute on function public.shared_profile(text) to anon, authenticated;
grant execute on function public.shared_events(text) to anon, authenticated;
revoke execute on function public.shared_places(text) from public;
revoke execute on function public.shared_profile(text) from public;
revoke execute on function public.shared_events(text) from public;


-- ####################################################################
-- ## Migration 008_voyages_partages_etapes_documents
-- ## source : supabase\migrations\008_voyages_partages_etapes_documents.sql
-- ####################################################################

-- ============================================================================
-- BuBuTravel  |  008 : voyages partages, etapes, documents, a faire
--
-- Pour un long voyage a deux (Thailande + Vietnam, dec. 2026 a fev. 2027) :
--   1. trip_members  : un voyage peut etre partage avec un autre compte.
--                      Tout ce qui est rattache au voyage devient visible et
--                      modifiable par les deux : lieux, photos, parcours,
--                      evenements, etapes, documents, a faire.
--   2. trip_stops    : l'itineraire par etapes (ville, dates, hebergement,
--                      transport vers l'etape suivante).
--   3. trip_documents: le coffre (passeport, visas, billets...), fichiers dans
--                      le bucket prive trip-docs, chemin {trip_id}/...
--   4. trip_todos    : les choses a faire, avec date et rappel. Reprend
--                      l'ancien pense-bete (trips.checklist).
--
-- Les heures des etapes et des a faire sont en `timestamp` SANS fuseau :
-- c'est l'heure locale du pays (« le vol part a 10 h 30 a Bangkok »), et
-- c'est exactement ce que le calendrier du telephone doit afficher.
--
-- Idempotent : rejouable sans casse.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. MEMBRES D'UN VOYAGE
-- ---------------------------------------------------------------------------
create table if not exists public.trip_members (
  trip_id   uuid not null references public.trips (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  added_at  timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create index if not exists trip_members_user_idx on public.trip_members (user_id);

alter table public.trip_members enable row level security;

/**
 * Proprietaire ou membre du voyage. security definer : la fonction est
 * appelee DEPUIS les policies de trips et de trip_members, elle doit lire ces
 * tables sans repasser par leurs policies, sinon recursion infinie.
 */
create or replace function public.is_trip_member(p_trip uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $function$
  select p_trip is not null and (
    exists (select 1 from public.trips t where t.id = p_trip and t.user_id = auth.uid())
    or exists (select 1 from public.trip_members m where m.trip_id = p_trip and m.user_id = auth.uid())
  )
$function$;

/** Meme chose a partir d'un chemin de fichier {trip_id}/... du bucket trip-docs. */
create or replace function public.is_trip_folder_member(p_name text)
returns boolean
language sql
security definer
stable
set search_path = public
as $function$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.is_trip_member(split_part(p_name, '/', 1)::uuid)
    else false
  end
$function$;

/** Une photo du bucket place-photos appartient-elle a un lieu d'un voyage partage ? */
create or replace function public.can_read_shared_photo(p_name text)
returns boolean
language sql
security definer
stable
set search_path = public
as $function$
  select exists (
    select 1
    from public.photos ph
    join public.places pl on pl.id = ph.place_id
    where ph.url = p_name and public.is_trip_member(pl.trip_id)
  )
$function$;

drop policy if exists "trip_members: voir ceux du voyage"   on public.trip_members;
drop policy if exists "trip_members: retirer ou partir"     on public.trip_members;

create policy "trip_members: voir ceux du voyage"
  on public.trip_members for select using (public.is_trip_member(trip_id));

-- Le proprietaire retire quelqu'un, ou un membre quitte le voyage lui-meme
create policy "trip_members: retirer ou partir"
  on public.trip_members for delete using (
    user_id = auth.uid()
    or exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid())
  );

-- Pas de policy insert : l'ajout passe par invite_trip_member, qui verifie
-- que l'appelant est le proprietaire et retrouve le compte par son email.

/**
 * Invite un compte existant par son email. Renvoie son nom affiche.
 * L'email n'est jamais expose : la recherche se fait cote serveur.
 */
create or replace function public.invite_trip_member(p_trip uuid, p_email text)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user uuid;
  v_name text;
begin
  if not exists (select 1 from public.trips t where t.id = p_trip and t.user_id = auth.uid()) then
    raise exception 'Seul le proprietaire du voyage peut inviter.' using errcode = '42501';
  end if;

  select u.id into v_user from auth.users u where lower(u.email) = lower(trim(p_email)) limit 1;
  if v_user is null then
    raise exception 'Aucun compte BuBuTravel avec cet email. La personne doit d''abord creer son compte.'
      using errcode = 'P0002';
  end if;
  if v_user = auth.uid() then
    raise exception 'C''est votre propre compte.' using errcode = '22023';
  end if;

  insert into public.trip_members (trip_id, user_id) values (p_trip, v_user)
  on conflict do nothing;

  select coalesce(p.display_name, split_part(u.email, '@', 1)) into v_name
  from auth.users u left join public.profiles p on p.id = u.id
  where u.id = v_user;

  return v_name;
end
$function$;

revoke all on function public.invite_trip_member(uuid, text) from anon;

/** Les personnes d'un voyage : proprietaire puis membres, sans email. */
create or replace function public.trip_people(p_trip uuid)
returns table (user_id uuid, display_name text, avatar_url text, is_owner boolean)
language sql
security definer
stable
set search_path = public
as $function$
  select x.user_id, coalesce(p.display_name, 'Voyageur'), p.avatar_url, x.is_owner
  from (
    select t.user_id, true as is_owner from public.trips t where t.id = p_trip
    union
    select m.user_id, false from public.trip_members m where m.trip_id = p_trip
  ) x
  left join public.profiles p on p.id = x.user_id
  where public.is_trip_member(p_trip)
  order by x.is_owner desc, p.display_name
$function$;

revoke all on function public.trip_people(uuid) from anon;

-- ---------------------------------------------------------------------------
-- 2. CE QUI EXISTE DEJA DEVIENT VISIBLE PAR LES MEMBRES DU VOYAGE
--    Policies AJOUTEES a cote des anciennes (elles se combinent en OU) :
--    le carnet personnel reste prive, seul ce qui est rattache a un voyage
--    partage s'ouvre.
-- ---------------------------------------------------------------------------
drop policy if exists "trips: lire les partages"     on public.trips;
drop policy if exists "trips: modifier les partages" on public.trips;
create policy "trips: lire les partages"
  on public.trips for select using (public.is_trip_member(id));
create policy "trips: modifier les partages"
  on public.trips for update using (public.is_trip_member(id)) with check (public.is_trip_member(id));

drop policy if exists "places: lire voyage partage"     on public.places;
drop policy if exists "places: modifier voyage partage" on public.places;
create policy "places: lire voyage partage"
  on public.places for select using (public.is_trip_member(trip_id));
create policy "places: modifier voyage partage"
  on public.places for update using (public.is_trip_member(trip_id))
  with check (auth.uid() = user_id or public.is_trip_member(trip_id));

drop policy if exists "photos: lire voyage partage" on public.photos;
create policy "photos: lire voyage partage"
  on public.photos for select using (
    exists (select 1 from public.places pl where pl.id = place_id and public.is_trip_member(pl.trip_id))
  );

drop policy if exists "tracks: lire voyage partage" on public.tracks;
create policy "tracks: lire voyage partage"
  on public.tracks for select using (public.is_trip_member(trip_id));

drop policy if exists "events: lire voyage partage"     on public.events;
drop policy if exists "events: modifier voyage partage" on public.events;
create policy "events: lire voyage partage"
  on public.events for select using (public.is_trip_member(trip_id));
create policy "events: modifier voyage partage"
  on public.events for update using (public.is_trip_member(trip_id))
  with check (auth.uid() = user_id or public.is_trip_member(trip_id));

drop policy if exists "photos: lire voyage partage" on storage.objects;
create policy "photos: lire voyage partage"
  on storage.objects for select
  using (bucket_id = 'place-photos' and public.can_read_shared_photo(name));

-- ---------------------------------------------------------------------------
-- 3. ETAPES DE L'ITINERAIRE
-- ---------------------------------------------------------------------------
create table if not exists public.trip_stops (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references public.trips (id) on delete cascade,
  created_by    uuid references auth.users (id) on delete set null default auth.uid(),
  position      integer not null default 0,

  name          text not null,
  country       text,
  lat           double precision,
  lng           double precision,
  arrive_date   date,
  leave_date    date,

  stay_name     text,
  stay_address  text,
  stay_ref      text,
  stay_url      text,

  /** Transport pour rejoindre l'etape SUIVANTE. */
  transport_mode     text,
  transport_details  text,
  transport_departs  timestamp,
  transport_arrives  timestamp,
  transport_ref      text,

  notes         text,
  created_at    timestamptz not null default now()
);

create index if not exists trip_stops_trip_idx on public.trip_stops (trip_id, position);

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'trip_stops_dates_check') then
    alter table public.trip_stops add constraint trip_stops_dates_check
      check (leave_date is null or arrive_date is null or leave_date >= arrive_date);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'trip_stops_mode_check') then
    alter table public.trip_stops add constraint trip_stops_mode_check
      check (transport_mode is null or transport_mode in
        ('plane', 'train', 'bus', 'boat', 'car', 'taxi', 'motorbike', 'other'));
  end if;
end
$do$;

alter table public.trip_stops enable row level security;

drop policy if exists "trip_stops: membres" on public.trip_stops;
create policy "trip_stops: membres"
  on public.trip_stops for all
  using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));

-- ---------------------------------------------------------------------------
-- 4. A FAIRE ET RAPPELS
-- ---------------------------------------------------------------------------
create table if not exists public.trip_todos (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips (id) on delete cascade,
  stop_id     uuid references public.trip_stops (id) on delete set null,
  created_by  uuid references auth.users (id) on delete set null default auth.uid(),

  title       text not null,
  notes       text,
  /** todo, booking (a reserver), admin (visa, assurance...), packing (valise) */
  kind        text not null default 'todo',
  /** Echeance en heure locale. Sans heure : a minuit, traite comme « dans la journee ». */
  due_at      timestamp,
  has_time    boolean not null default false,
  /** Minutes avant l'echeance pour l'alarme du calendrier, null = pas d'alarme. */
  remind_minutes integer,

  done        boolean not null default false,
  done_by     uuid references auth.users (id) on delete set null,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists trip_todos_trip_idx on public.trip_todos (trip_id, done, due_at);

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'trip_todos_kind_check') then
    alter table public.trip_todos add constraint trip_todos_kind_check
      check (kind in ('todo', 'booking', 'admin', 'packing'));
  end if;
end
$do$;

alter table public.trip_todos enable row level security;

drop policy if exists "trip_todos: membres" on public.trip_todos;
create policy "trip_todos: membres"
  on public.trip_todos for all
  using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));

-- L'ancien pense-bete (jsonb dans trips.checklist) passe dans trip_todos.
-- Les identifiants sont repris, donc rejouer ne cree pas de doublon.
insert into public.trip_todos (id, trip_id, created_by, title, done, kind, position)
select (item->>'id')::uuid, t.id, t.user_id, item->>'text',
       coalesce((item->>'done')::boolean, false), 'todo', (ord - 1)::int
from public.trips t,
     jsonb_array_elements(coalesce(t.checklist, '[]'::jsonb)) with ordinality as x(item, ord)
where jsonb_typeof(t.checklist) = 'array'
  and (item->>'id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and coalesce(item->>'text', '') <> ''
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 5. DOCUMENTS
-- ---------------------------------------------------------------------------
create table if not exists public.trip_documents (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips (id) on delete cascade,
  stop_id     uuid references public.trip_stops (id) on delete set null,
  created_by  uuid references auth.users (id) on delete set null default auth.uid(),

  /** passport, visa, flight, transport, stay, insurance, health, money, other */
  kind        text not null default 'other',
  title       text not null,
  /** A qui il appartient (« Diego », « nous deux »...). */
  holder      text,
  /** Numero de reservation, de vol, de police d'assurance... */
  reference   text,
  doc_date    date,
  valid_until date,
  notes       text,

  /** Chemin dans le bucket prive trip-docs : {trip_id}/{uuid}-{nom}. */
  path        text,
  file_name   text,
  mime        text,
  size_bytes  bigint,

  created_at  timestamptz not null default now()
);

create index if not exists trip_documents_trip_idx on public.trip_documents (trip_id, kind);

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'trip_documents_kind_check') then
    alter table public.trip_documents add constraint trip_documents_kind_check
      check (kind in ('passport', 'visa', 'flight', 'transport', 'stay', 'insurance',
                      'health', 'money', 'other'));
  end if;
end
$do$;

alter table public.trip_documents enable row level security;

drop policy if exists "trip_documents: membres" on public.trip_documents;
create policy "trip_documents: membres"
  on public.trip_documents for all
  using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));

insert into storage.buckets (id, name, public, file_size_limit)
values ('trip-docs', 'trip-docs', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;

drop policy if exists "trip-docs: lire"     on storage.objects;
drop policy if exists "trip-docs: ecrire"   on storage.objects;
drop policy if exists "trip-docs: supprimer" on storage.objects;

create policy "trip-docs: lire"
  on storage.objects for select
  using (bucket_id = 'trip-docs' and public.is_trip_folder_member(name));
create policy "trip-docs: ecrire"
  on storage.objects for insert
  with check (bucket_id = 'trip-docs' and public.is_trip_folder_member(name));
create policy "trip-docs: supprimer"
  on storage.objects for delete
  using (bucket_id = 'trip-docs' and public.is_trip_folder_member(name));

-- ---------------------------------------------------------------------------
-- 6. IDEES : liens TikTok / Instagram / YouTube / Google Maps a analyser
--    L'app cree la ligne (status pending). L'analyseur (programme Python sur
--    le PC, plus tard sur un VPS) la prend, telecharge la video en 480p,
--    extrait les images, transcrit la voix, cherche sur le web, puis ecrit
--    le resultat dans `analysis` (status ready).
--    Sans voyage (trip_id null), l'idee vit dans la wishlist.
-- ---------------------------------------------------------------------------
create table if not exists public.link_ideas (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade default auth.uid(),
  trip_id     uuid references public.trips (id) on delete set null,

  url         text not null,
  platform    text,
  /** Precisions tapees par l'utilisateur (« tour en bateau au lever du soleil »). */
  note        text,

  /** pending, processing, ready, error, archived */
  status      text not null default 'pending',
  error       text,
  attempts    integer not null default 0,

  title       text,
  thumbnail   text,
  /** Resultat structure de l'analyse, voir src/lib/ideas.ts */
  analysis    jsonb,
  /** Lieu cree quand l'idee a ete ajoutee au voyage ou aux envies. */
  place_id    uuid references public.places (id) on delete set null,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists link_ideas_user_idx   on public.link_ideas (user_id, created_at desc);
create index if not exists link_ideas_trip_idx   on public.link_ideas (trip_id);
create index if not exists link_ideas_status_idx on public.link_ideas (status, created_at);

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'link_ideas_status_check') then
    alter table public.link_ideas add constraint link_ideas_status_check
      check (status in ('pending', 'processing', 'ready', 'error', 'archived'));
  end if;
end
$do$;

alter table public.link_ideas enable row level security;

drop policy if exists "link_ideas: lire"      on public.link_ideas;
drop policy if exists "link_ideas: creer"     on public.link_ideas;
drop policy if exists "link_ideas: modifier"  on public.link_ideas;
drop policy if exists "link_ideas: supprimer" on public.link_ideas;

create policy "link_ideas: lire"
  on public.link_ideas for select
  using (auth.uid() = user_id or public.is_trip_member(trip_id));
create policy "link_ideas: creer"
  on public.link_ideas for insert
  with check (auth.uid() = user_id and (trip_id is null or public.is_trip_member(trip_id)));
create policy "link_ideas: modifier"
  on public.link_ideas for update
  using (auth.uid() = user_id or public.is_trip_member(trip_id))
  with check (auth.uid() = user_id or public.is_trip_member(trip_id));
create policy "link_ideas: supprimer"
  on public.link_ideas for delete
  using (auth.uid() = user_id or public.is_trip_member(trip_id));

-- Etat de l'analyseur : l'app affiche « analyseur en ligne / hors ligne ».
-- Une seule ligne par machine, ecrite par l'analyseur avec la cle service.
create table if not exists public.analyzer_status (
  id          text primary key,
  last_seen   timestamptz not null default now(),
  version     text
);

alter table public.analyzer_status enable row level security;

drop policy if exists "analyzer_status: lire" on public.analyzer_status;
create policy "analyzer_status: lire"
  on public.analyzer_status for select using (auth.uid() is not null);

-- Les deux voyageurs voient les idees de l'autre arriver sans recharger
do $do$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'link_ideas'
  ) then
    alter publication supabase_realtime add table public.link_ideas;
  end if;
end
$do$;

-- PostgREST relit le schema tout de suite, sans attendre
notify pgrst, 'reload schema';


-- ####################################################################
-- ## Migration 009_brouillons
-- ## source : supabase\migrations\009_brouillons.sql
-- ####################################################################

-- ============================================================================
-- BuBuTravel  |  009 : brouillons
--
-- Tout ce qu'on commence sans le finir (une etape, un document, un lien
-- colle, une demande a l'assistant) est garde ici, au fil de la frappe.
-- On le retrouve dans le tiroir « Brouillons », sur n'importe quel appareil.
-- Prive : chacun ne voit que les siens.
--
-- Idempotent.
-- ============================================================================

create table if not exists public.drafts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade default auth.uid(),
  /** Identifiant stable cote app, ex. « assistant:<trip_id> », « idea-link ». */
  key         text not null,
  /** assistant, stop, document, idea, todo */
  kind        text not null,
  trip_id     uuid references public.trips (id) on delete cascade,
  title       text,
  /** Lien pour reprendre exactement ou l'on en etait. */
  resume_url  text,
  payload     jsonb not null default '{}'::jsonb,
  remind_at   timestamptz,
  updated_at  timestamptz not null default now(),
  unique (user_id, key)
);

create index if not exists drafts_user_idx on public.drafts (user_id, updated_at desc);

alter table public.drafts enable row level security;

drop policy if exists "drafts: les siens" on public.drafts;
create policy "drafts: les siens"
  on public.drafts for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

notify pgrst, 'reload schema';


-- ####################################################################
-- ## Migration 010_ai_jobs
-- ## source : supabase\migrations\010_ai_jobs.sql
-- ####################################################################

-- ============================================================================
-- BuBuTravel  |  010 : demandes a l'IA traitees par l'analyseur
--
-- L'IA tourne sur le PC (plus tard un VPS) via Claude Code et l'abonnement
-- Claude de Diego, pas via une cle API sur Vercel. L'app depose une demande
-- (ex. « propose un itineraire »), l'analyseur la traite et ecrit le
-- resultat ; l'app le recoit en temps reel.
--
-- Idempotent.
-- ============================================================================

create table if not exists public.ai_jobs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade default auth.uid(),
  trip_id     uuid references public.trips (id) on delete cascade,
  /** itinerary */
  kind        text not null,
  input       jsonb not null default '{}'::jsonb,
  /** pending, processing, ready, error */
  status      text not null default 'pending',
  result      jsonb,
  error       text,
  attempts    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists ai_jobs_status_idx on public.ai_jobs (status, created_at);

alter table public.ai_jobs enable row level security;

drop policy if exists "ai_jobs: les siennes" on public.ai_jobs;
create policy "ai_jobs: les siennes"
  on public.ai_jobs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and (trip_id is null or public.is_trip_member(trip_id)));

do $do$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ai_jobs'
  ) then
    alter publication supabase_realtime add table public.ai_jobs;
  end if;
end
$do$;

notify pgrst, 'reload schema';


-- ####################################################################
-- ## Migration 011_pays
-- ## source : supabase\migrations\011_pays.sql
-- ####################################################################

-- ============================================================================
-- BuBuTravel  |  011 : fiches pays et check-lists par pays
--
-- Pour chaque pays du voyage : moyens de paiement (carte, liquide, paiement
-- mobile, distributeurs), entree, prises, SIM, urgences, arnaques. La fiche
-- est preparee par l'IA (analyseur + abonnement Claude) et gardee ici.
-- Les check-lists sont les a faire du voyage : `country` null = generale.
--
-- Idempotent.
-- ============================================================================

alter table public.trip_todos add column if not exists country text;
create index if not exists trip_todos_country_idx on public.trip_todos (trip_id, country);

create table if not exists public.country_guides (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips (id) on delete cascade,
  country     text not null,
  guide       jsonb,
  updated_at  timestamptz not null default now(),
  unique (trip_id, country)
);

alter table public.country_guides enable row level security;

drop policy if exists "country_guides: membres" on public.country_guides;
create policy "country_guides: membres"
  on public.country_guides for all
  using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));

notify pgrst, 'reload schema';


-- ####################################################################
-- ## Migration 012_photo_lieu
-- ## source : supabase\migrations\012_photo_lieu.sql
-- ####################################################################

-- ============================================================================
-- BuBuTravel  |  012 : photo d'illustration d'un lieu
--
-- Photo trouvee en ligne (Wikipedia / Wikimedia, sous licence libre) pour
-- rendre les listes plus vivantes. Distincte des photos des voyageurs.
-- null = pas encore cherchee ; '' = cherchee, rien de trouve.
--
-- Idempotent.
-- ============================================================================

alter table public.places add column if not exists image_url text;

notify pgrst, 'reload schema';


-- ####################################################################
-- ## Migration 013_galerie
-- ## source : supabase\migrations\013_galerie.sql
-- ####################################################################

-- ============================================================================
-- BuBuTravel  |  013 : galerie d'images des lieux et des idees
--
-- Images tirees des videos analysees (TikTok, Instagram, YouTube) : elles
-- montrent le vrai endroit, contrairement a une recherche d'image au hasard.
-- Stockees dans le bucket public idea-frames (contenu deja public a
-- l'origine), ecrit uniquement par l'analyseur (cle service).
--
-- Idempotent.
-- ============================================================================

alter table public.places add column if not exists gallery jsonb not null default '[]'::jsonb;
alter table public.link_ideas add column if not exists frames jsonb not null default '[]'::jsonb;

insert into storage.buckets (id, name, public, file_size_limit)
values ('idea-frames', 'idea-frames', true, 2097152)
on conflict (id) do update set public = true;

notify pgrst, 'reload schema';


-- ####################################################################
-- ## Migration 014_details_lieu
-- ## source : supabase\migrations\014_details_lieu.sql
-- ####################################################################

-- ============================================================================
-- BuBuTravel  |  014 : fiche detaillee d'un lieu
--
-- Infos pratiques trouvees par l'analyseur (video analysee ou recherche web) :
-- resume, prix, horaires, plats et menu, reservation, conseils, images.
--
-- Idempotent.
-- ============================================================================

alter table public.places add column if not exists details jsonb;

notify pgrst, 'reload schema';


-- ####################################################################
-- ## Migration 015_programme
-- ## source : supabase\migrations\015_programme.sql
-- ####################################################################

-- ============================================================================
-- BuBuTravel  |  015 : programme du voyage
--
-- Une chose a faire peut etre placee dans le voyage : un jour (visit_date,
-- deja existant), une heure de debut et une duree. Sert a construire le
-- programme jour par jour et a detecter les chevauchements.
--
-- Idempotent.
-- ============================================================================

alter table public.places add column if not exists plan_time text;
alter table public.places add column if not exists plan_minutes integer;

notify pgrst, 'reload schema';


-- ####################################################################
-- ## Migration 016_avis_compagnons
-- ## source : supabase\migrations\016_avis_compagnons.sql
-- ####################################################################

-- ============================================================================
-- BuBuTravel  |  016 : avis par voyageur, compagnons de voyage
--
-- 1. places.feedback : l'avis de chaque voyageur sur un lieu visite,
--    { "<user_id>": { name, price, service, vibe, again, comment, at } }.
--    Chacun ecrit le sien via set_place_feedback (pas d'ecrasement de l'avis
--    de l'autre), lisible par les membres du voyage.
-- 2. add_trip_companion : ajouter en un tap une personne avec qui on a deja
--    voyage (sans retaper son email).
-- 3. my_companions : les personnes avec qui on partage au moins un voyage.
--
-- Idempotent.
-- ============================================================================

alter table public.places add column if not exists feedback jsonb not null default '{}'::jsonb;

create or replace function public.set_place_feedback(p_place uuid, p_feedback jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_place public.places;
  v_name text;
  v_out jsonb;
begin
  select * into v_place from public.places where id = p_place;
  if v_place.id is null then
    raise exception 'Lieu introuvable' using errcode = 'P0002';
  end if;
  if not (v_place.user_id = auth.uid() or public.is_trip_member(v_place.trip_id)) then
    raise exception 'Acces refuse' using errcode = '42501';
  end if;
  select coalesce(display_name, 'Voyageur') into v_name from public.profiles where id = auth.uid();
  update public.places
     set feedback = coalesce(feedback, '{}'::jsonb)
                    || jsonb_build_object(auth.uid()::text, p_feedback || jsonb_build_object('name', v_name, 'at', now()))
   where id = p_place
  returning feedback into v_out;
  return v_out;
end
$function$;

revoke all on function public.set_place_feedback(uuid, jsonb) from anon;

create or replace function public.my_companions()
returns table (user_id uuid, display_name text, avatar_url text)
language sql
security definer
stable
set search_path = public
as $function$
  with mine as (
    select t.id from public.trips t where t.user_id = auth.uid()
    union
    select m.trip_id from public.trip_members m where m.user_id = auth.uid()
  ), people as (
    select t.user_id from public.trips t where t.id in (select id from mine)
    union
    select m.user_id from public.trip_members m where m.trip_id in (select id from mine)
  )
  select p.id, coalesce(p.display_name, 'Voyageur'), p.avatar_url
  from public.profiles p
  where p.id in (select user_id from people) and p.id <> auth.uid()
$function$;

revoke all on function public.my_companions() from anon;

create or replace function public.add_trip_companion(p_trip uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not exists (select 1 from public.trips t where t.id = p_trip and t.user_id = auth.uid()) then
    raise exception 'Seul l''organisateur du voyage peut inviter.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.my_companions() c where c.user_id = p_user) then
    raise exception 'Cette personne n''a encore partage aucun voyage avec vous : invitez-la par email.' using errcode = '42501';
  end if;
  insert into public.trip_members (trip_id, user_id) values (p_trip, p_user) on conflict do nothing;
end
$function$;

revoke all on function public.add_trip_companion(uuid, uuid) from anon;

notify pgrst, 'reload schema';


-- ####################################################################
-- ## Migration 017_coffre
-- ## source : supabase\migrations\017_coffre.sql
-- ####################################################################

-- ============================================================================
-- BuBuTravel  |  017 : coffre personnel
--
-- Passeports, cartes d'identite, cartes bancaires (4 derniers chiffres
-- seulement), numeros importants, assurance, billets et QR codes.
-- Prive par defaut ; « shared » le rend visible aux compagnons de voyage
-- (personnes avec qui on partage au moins un voyage), en lecture seule.
-- Fichiers dans le bucket prive « vault », chemin {user_id}/{uuid}.{ext}.
--
-- Idempotent.
-- ============================================================================

create table if not exists public.vault_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade default auth.uid(),
  /** identity, card, contact, insurance, ticket, other */
  kind        text not null default 'other',
  title       text not null,
  holder      text,
  /** Numero du document, ou 4 derniers chiffres d'une carte. */
  number      text,
  expires     date,
  phone       text,
  email       text,
  url         text,
  notes       text,
  /** Chemins des fichiers (recto, verso, QR...) dans le bucket vault. */
  files       jsonb not null default '[]'::jsonb,
  shared      boolean not null default false,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists vault_items_user_idx on public.vault_items (user_id, kind);

alter table public.vault_items enable row level security;

/** Le proprietaire de la ligne voyage-t-il avec moi ? */
create or replace function public.is_companion(p_user uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $function$
  select exists (select 1 from public.my_companions() c where c.user_id = p_user)
$function$;

drop policy if exists "vault: les siens"            on public.vault_items;
drop policy if exists "vault: partages, en lecture" on public.vault_items;

create policy "vault: les siens"
  on public.vault_items for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "vault: partages, en lecture"
  on public.vault_items for select
  using (shared and public.is_companion(user_id));

insert into storage.buckets (id, name, public, file_size_limit)
values ('vault', 'vault', false, 15728640)
on conflict (id) do update set public = false;

/** Un fichier du coffre est lisible par son proprietaire, ou par un compagnon si l'element est partage. */
create or replace function public.can_read_vault_file(p_name text)
returns boolean
language sql
security definer
stable
set search_path = public
as $function$
  select (storage.foldername(p_name))[1] = auth.uid()::text
      or exists (
        select 1 from public.vault_items v
        where v.shared and v.files ? p_name and public.is_companion(v.user_id)
      )
$function$;

drop policy if exists "vault: lire"      on storage.objects;
drop policy if exists "vault: ecrire"    on storage.objects;
drop policy if exists "vault: supprimer" on storage.objects;

create policy "vault: lire"
  on storage.objects for select
  using (bucket_id = 'vault' and public.can_read_vault_file(name));
create policy "vault: ecrire"
  on storage.objects for insert
  with check (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "vault: supprimer"
  on storage.objects for delete
  using (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text);

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Code du coffre (5 chiffres). Seule une empreinte PBKDF2 salee est gardee,
-- jamais le code lui-meme. C'est un verrou d'usage : la vraie protection
-- reste le compte (session Supabase + RLS).
-- ---------------------------------------------------------------------------
create table if not exists public.vault_pins (
  user_id    uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  salt       text not null,
  hash       text not null,
  updated_at timestamptz not null default now()
);

alter table public.vault_pins enable row level security;

drop policy if exists "vault_pins: le sien" on public.vault_pins;
create policy "vault_pins: le sien"
  on public.vault_pins for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

notify pgrst, 'reload schema';


-- ####################################################################
-- ## Migration 018_hotes_accueil
-- ## source : supabase\migrations\018_hotes_accueil.sql
-- ####################################################################

-- 018 : contacts des hotes par hebergement, et ecran d'accueil du profil.
--
-- 1. trip_stops.hosts : liste des hebergements d'une etape avec le contact de
--    l'hote ([{ stay, name, phone, email, note }]). Une etape peut en avoir
--    plusieurs (Phuket : deux logements).
-- 2. profiles.greeting : ecran « Bonjour / Bonsoir » a l'ouverture de l'app,
--    'big' (grande photo), 'small' (petite photo) ou 'off'.

alter table public.trip_stops add column if not exists hosts jsonb not null default '[]'::jsonb;

alter table public.profiles add column if not exists greeting text not null default 'big';
alter table public.profiles drop constraint if exists profiles_greeting_check;
alter table public.profiles add constraint profiles_greeting_check check (greeting in ('big', 'small', 'off'));
