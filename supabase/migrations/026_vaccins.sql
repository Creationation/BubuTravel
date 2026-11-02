-- 026 : vaccins du voyage. Propositions de l'IA par pays, puis decision de
-- chacun (a prendre / pris / deja pris / non) avec son cout reel.
-- entries : { "<user_id>": { status, cost, currency, expense_id, date } }
create table if not exists public.trip_vaccines (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips (id) on delete cascade,
  country     text not null,
  name        text not null,
  level       text not null default 'recommended' check (level in ('required', 'recommended', 'consider')),
  why         text,
  timing      text,
  doses       text,
  advice      text,
  est_price   numeric(10,2),
  currency    text not null default 'EUR',
  sources     jsonb not null default '[]'::jsonb,
  entries     jsonb not null default '{}'::jsonb,
  todo_id     uuid references public.trip_todos (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists trip_vaccines_trip_idx on public.trip_vaccines (trip_id, country);
alter table public.trip_vaccines enable row level security;

drop policy if exists "trip_vaccines: membres" on public.trip_vaccines;
create policy "trip_vaccines: membres"
  on public.trip_vaccines for all
  using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));

notify pgrst, 'reload schema';
