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
