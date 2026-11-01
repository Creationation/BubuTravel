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
