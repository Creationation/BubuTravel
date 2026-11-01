-- ============================================================================
-- BuBuTravel  |  017 : coffre personnel
--
-- Passeports, cartes d'identite, cartes bancaires (4 derniers chiffres
-- seulement), numeros importants, assurance, billets et QR codes.
-- Prive par defaut ; « shared » le rend visible aux compagnons de voyage
-- (personnes avec qui on partage au moins un voyage), en lecture seule.
-- Fichiers dans le bucket prive « vault », chemin {user_id}/{uuid}.{ext}.
--
-- Idempotent.
-- ============================================================================

create table if not exists public.vault_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade default auth.uid(),
  /** identity, card, contact, insurance, ticket, other */
  kind        text not null default 'other',
  title       text not null,
  holder      text,
  /** Numero du document, ou 4 derniers chiffres d'une carte. */
  number      text,
  expires     date,
  phone       text,
  email       text,
  url         text,
  notes       text,
  /** Chemins des fichiers (recto, verso, QR...) dans le bucket vault. */
  files       jsonb not null default '[]'::jsonb,
  shared      boolean not null default false,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists vault_items_user_idx on public.vault_items (user_id, kind);

alter table public.vault_items enable row level security;

/** Le proprietaire de la ligne voyage-t-il avec moi ? */
create or replace function public.is_companion(p_user uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $function$
  select exists (select 1 from public.my_companions() c where c.user_id = p_user)
$function$;

drop policy if exists "vault: les siens"            on public.vault_items;
drop policy if exists "vault: partages, en lecture" on public.vault_items;

create policy "vault: les siens"
  on public.vault_items for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "vault: partages, en lecture"
  on public.vault_items for select
  using (shared and public.is_companion(user_id));

insert into storage.buckets (id, name, public, file_size_limit)
values ('vault', 'vault', false, 15728640)
on conflict (id) do update set public = false;

/** Un fichier du coffre est lisible par son proprietaire, ou par un compagnon si l'element est partage. */
create or replace function public.can_read_vault_file(p_name text)
returns boolean
language sql
security definer
stable
set search_path = public
as $function$
  select (storage.foldername(p_name))[1] = auth.uid()::text
      or exists (
        select 1 from public.vault_items v
        where v.shared and v.files ? p_name and public.is_companion(v.user_id)
      )
$function$;

drop policy if exists "vault: lire"      on storage.objects;
drop policy if exists "vault: ecrire"    on storage.objects;
drop policy if exists "vault: supprimer" on storage.objects;

create policy "vault: lire"
  on storage.objects for select
  using (bucket_id = 'vault' and public.can_read_vault_file(name));
create policy "vault: ecrire"
  on storage.objects for insert
  with check (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "vault: supprimer"
  on storage.objects for delete
  using (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text);

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Code du coffre (5 chiffres). Seule une empreinte PBKDF2 salee est gardee,
-- jamais le code lui-meme. C'est un verrou d'usage : la vraie protection
-- reste le compte (session Supabase + RLS).
-- ---------------------------------------------------------------------------
create table if not exists public.vault_pins (
  user_id    uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  salt       text not null,
  hash       text not null,
  updated_at timestamptz not null default now()
);

alter table public.vault_pins enable row level security;

drop policy if exists "vault_pins: le sien" on public.vault_pins;
create policy "vault_pins: le sien"
  on public.vault_pins for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
