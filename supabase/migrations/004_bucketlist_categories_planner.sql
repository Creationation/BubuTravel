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
