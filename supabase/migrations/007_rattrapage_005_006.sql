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
