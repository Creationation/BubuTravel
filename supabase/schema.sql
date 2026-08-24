-- ============================================================================
-- BuBuTravel  |  schema complet v1
-- A coller dans Supabase > SQL Editor > New query > Run
-- Idempotent : peut etre rejoue sans casse.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. PROFILS
--    Une ligne par compte auth. Cree automatiquement par le trigger plus bas.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: lire le sien"     on public.profiles;
drop policy if exists "profiles: creer le sien"    on public.profiles;
drop policy if exists "profiles: modifier le sien" on public.profiles;

create policy "profiles: lire le sien"
  on public.profiles for select using (auth.uid() = id);
create policy "profiles: creer le sien"
  on public.profiles for insert with check (auth.uid() = id);
create policy "profiles: modifier le sien"
  on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- 2. LIEUX VISITES
-- ---------------------------------------------------------------------------
create table if not exists public.places (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  country    text not null,
  lat        double precision not null,
  lng        double precision not null,
  visit_date date,
  notes      text,
  created_at timestamptz not null default now()
);

create index if not exists places_user_id_idx    on public.places (user_id);
create index if not exists places_visit_date_idx on public.places (user_id, visit_date desc);

alter table public.places enable row level security;

drop policy if exists "places: lire les siens"      on public.places;
drop policy if exists "places: creer les siens"     on public.places;
drop policy if exists "places: modifier les siens"  on public.places;
drop policy if exists "places: supprimer les siens" on public.places;

create policy "places: lire les siens"
  on public.places for select using (auth.uid() = user_id);
create policy "places: creer les siens"
  on public.places for insert with check (auth.uid() = user_id);
create policy "places: modifier les siens"
  on public.places for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "places: supprimer les siens"
  on public.places for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. PHOTOS
--    La colonne url contient le CHEMIN dans le bucket prive place-photos
--    (format : {user_id}/{place_id}/{uuid}.{ext}), pas une URL publique.
--    L'app genere une URL signee au moment de l'affichage.
-- ---------------------------------------------------------------------------
create table if not exists public.photos (
  id          uuid primary key default gen_random_uuid(),
  place_id    uuid not null references public.places (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  url         text not null,
  uploaded_at timestamptz not null default now()
);

create index if not exists photos_place_id_idx on public.photos (place_id);
create index if not exists photos_user_id_idx  on public.photos (user_id);

alter table public.photos enable row level security;

drop policy if exists "photos: lire les siennes"      on public.photos;
drop policy if exists "photos: creer les siennes"     on public.photos;
drop policy if exists "photos: supprimer les siennes" on public.photos;

create policy "photos: lire les siennes"
  on public.photos for select using (auth.uid() = user_id);
create policy "photos: creer les siennes"
  on public.photos for insert with check (auth.uid() = user_id);
create policy "photos: supprimer les siennes"
  on public.photos for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 4. TRIGGER : creer le profil a l'inscription
--    A appliquer AVANT de creer les comptes, sinon les comptes existants
--    n'ont pas de ligne profiles et l'app plante apres le login.
--    Le backfill juste en dessous rattrape ce cas.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill des comptes crees avant ce trigger
insert into public.profiles (id, display_name)
select u.id, coalesce(u.raw_user_meta_data ->> 'display_name', split_part(u.email, '@', 1))
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- ---------------------------------------------------------------------------
-- 5. STORAGE
--    avatars      : lecture publique (photo de profil)
--    place-photos : prive, lecture via URL signee uniquement
--    Dans les deux cas le premier dossier du chemin doit etre l'uuid du user.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

insert into storage.buckets (id, name, public)
values ('place-photos', 'place-photos', false)
on conflict (id) do update set public = false;

drop policy if exists "avatars: lecture publique"     on storage.objects;
drop policy if exists "avatars: ecrire son dossier"   on storage.objects;
drop policy if exists "avatars: modifier son dossier" on storage.objects;
drop policy if exists "avatars: vider son dossier"    on storage.objects;
drop policy if exists "photos: lire son dossier"      on storage.objects;
drop policy if exists "photos: ecrire son dossier"    on storage.objects;
drop policy if exists "photos: vider son dossier"     on storage.objects;

create policy "avatars: lecture publique"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars: ecrire son dossier"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars: modifier son dossier"
  on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars: vider son dossier"
  on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "photos: lire son dossier"
  on storage.objects for select
  using (bucket_id = 'place-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "photos: ecrire son dossier"
  on storage.objects for insert
  with check (bucket_id = 'place-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "photos: vider son dossier"
  on storage.objects for delete
  using (bucket_id = 'place-photos' and (storage.foldername(name))[1] = auth.uid()::text);
