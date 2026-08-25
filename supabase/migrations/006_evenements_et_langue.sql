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
