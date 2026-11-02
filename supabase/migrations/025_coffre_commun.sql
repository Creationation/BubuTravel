-- 025 : coffre commun. Chacun choisit AVEC QUI il partage son coffre
-- (vault_shares), et quels elements restent prives (vault_items.shared).
-- Les elements partages se lisent ET se modifient des deux cotes.

create table if not exists public.vault_shares (
  owner_id   uuid not null references auth.users (id) on delete cascade default auth.uid(),
  member_id  uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, member_id)
);
alter table public.vault_shares enable row level security;

drop policy if exists "vault_shares: voir"      on public.vault_shares;
drop policy if exists "vault_shares: ajouter"   on public.vault_shares;
drop policy if exists "vault_shares: retirer"   on public.vault_shares;
create policy "vault_shares: voir"    on public.vault_shares for select using (owner_id = auth.uid() or member_id = auth.uid());
create policy "vault_shares: ajouter" on public.vault_shares for insert with check (owner_id = auth.uid() and public.is_companion(member_id));
create policy "vault_shares: retirer" on public.vault_shares for delete using (owner_id = auth.uid());

/** Le proprietaire p_owner partage-t-il son coffre avec moi ? */
create or replace function public.vault_shared_with_me(p_owner uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $function$
  select exists (select 1 from public.vault_shares s where s.owner_id = p_owner and s.member_id = auth.uid())
$function$;

drop policy if exists "vault: partages, en lecture"  on public.vault_items;
drop policy if exists "vault: partages, modifier"    on public.vault_items;
drop policy if exists "vault: partages, supprimer"   on public.vault_items;
create policy "vault: partages, en lecture"
  on public.vault_items for select using (shared and public.vault_shared_with_me(user_id));
create policy "vault: partages, modifier"
  on public.vault_items for update
  using (shared and public.vault_shared_with_me(user_id))
  with check (public.vault_shared_with_me(user_id));
create policy "vault: partages, supprimer"
  on public.vault_items for delete using (shared and public.vault_shared_with_me(user_id));

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
        where v.shared and v.files ? p_name and public.vault_shared_with_me(v.user_id)
      )
$function$;

-- Partage par defaut : les nouveaux elements sont communs, on garde la main pour en rendre prives
alter table public.vault_items alter column shared set default true;
update public.vault_items set shared = true;

-- Diego et Vesna : coffre commun des le depart
insert into public.vault_shares (owner_id, member_id) values
  ('f7709a6e-8301-4cdb-9bce-b1338cafead4', 'e46f4c9a-db33-46a7-88de-d359d4bdb0be'),
  ('e46f4c9a-db33-46a7-88de-d359d4bdb0be', 'f7709a6e-8301-4cdb-9bce-b1338cafead4')
on conflict do nothing;

notify pgrst, 'reload schema';
