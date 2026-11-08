-- 028 : jours complets de l'agenda, partages entre les voyageurs.
-- Un jour marque « complet » (avec une raison facultative) n'affiche plus de
-- rappel pour personne, tant qu'il n'est pas rouvert.
create table if not exists public.trip_day_status (
  trip_id    uuid not null references public.trips (id) on delete cascade,
  day        date not null,
  reason     text not null default '',
  user_id    uuid references auth.users (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (trip_id, day)
);
alter table public.trip_day_status enable row level security;

drop policy if exists "trip_day_status: membres" on public.trip_day_status;
create policy "trip_day_status: membres"
  on public.trip_day_status for all
  using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));

do $$ begin
  alter publication supabase_realtime add table public.trip_day_status;
exception when others then null;
end $$;

notify pgrst, 'reload schema';
