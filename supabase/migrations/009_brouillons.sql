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
