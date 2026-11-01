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
