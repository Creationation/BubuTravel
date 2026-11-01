-- 019 : assistant prive (conversation avec photos), par personne et par voyage.
--
-- assistant_messages : les messages de la conversation. role = user | assistant.
--   images : chemins dans le bucket prive « assistant » (20 au plus).
--   actions : propositions de l'assistant a appliquer d'un toucher.
--   status : 'pending' tant que l'assistant n'a pas repondu (messages user).

create table if not exists public.assistant_messages (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade default auth.uid(),
  role        text not null default 'user' check (role in ('user', 'assistant')),
  content     text not null default '',
  images      text[] not null default '{}',
  actions     jsonb not null default '[]'::jsonb,
  applied     jsonb not null default '[]'::jsonb,
  status      text not null default 'done',
  created_at  timestamptz not null default now()
);

create index if not exists assistant_messages_conv_idx on public.assistant_messages (trip_id, user_id, created_at);

alter table public.assistant_messages enable row level security;

drop policy if exists "assistant: sa conversation" on public.assistant_messages;
create policy "assistant: sa conversation"
  on public.assistant_messages for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and public.is_trip_member(trip_id));

do $do$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'assistant_messages'
  ) then
    alter publication supabase_realtime add table public.assistant_messages;
  end if;
end
$do$;

-- Photos envoyees a l'assistant : bucket prive, chacun son dossier
insert into storage.buckets (id, name, public)
values ('assistant', 'assistant', false)
on conflict (id) do nothing;

drop policy if exists "assistant: lire"   on storage.objects;
drop policy if exists "assistant: ecrire" on storage.objects;
create policy "assistant: lire"
  on storage.objects for select
  using (bucket_id = 'assistant' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "assistant: ecrire"
  on storage.objects for insert
  with check (bucket_id = 'assistant' and (storage.foldername(name))[1] = auth.uid()::text);

notify pgrst, 'reload schema';
