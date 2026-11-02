-- 024 : un voyage a deux, memes droits pour chaque membre (createur compris).
-- Chacun peut modifier et supprimer tout ce que contient le voyage, inviter,
-- et quitter le voyage ; personne ne peut retirer l'autre.

-- Voyage lui-meme
drop policy if exists "trips: supprimer les partages" on public.trips;
create policy "trips: supprimer les partages"
  on public.trips for delete using (public.is_trip_member(id));

-- Lieux
drop policy if exists "places: supprimer voyage partage" on public.places;
create policy "places: supprimer voyage partage"
  on public.places for delete using (public.is_trip_member(trip_id));

-- Photos des lieux (ligne en base et fichier)
drop policy if exists "photos: supprimer voyage partage" on public.photos;
create policy "photos: supprimer voyage partage"
  on public.photos for delete using (
    exists (select 1 from public.places pl where pl.id = place_id and public.is_trip_member(pl.trip_id))
  );
drop policy if exists "photos: supprimer voyage partage" on storage.objects;
create policy "photos: supprimer voyage partage"
  on storage.objects for delete
  using (bucket_id = 'place-photos' and public.can_read_shared_photo(name));

-- Parcours
drop policy if exists "tracks: modifier voyage partage" on public.tracks;
drop policy if exists "tracks: supprimer voyage partage" on public.tracks;
create policy "tracks: modifier voyage partage"
  on public.tracks for update using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));
create policy "tracks: supprimer voyage partage"
  on public.tracks for delete using (public.is_trip_member(trip_id));

-- Evenements
drop policy if exists "events: supprimer voyage partage" on public.events;
create policy "events: supprimer voyage partage"
  on public.events for delete using (public.is_trip_member(trip_id));

-- Depenses du voyage
drop policy if exists "expenses: modifier voyage partage" on public.expenses;
drop policy if exists "expenses: supprimer voyage partage" on public.expenses;
create policy "expenses: modifier voyage partage"
  on public.expenses for update
  using (trip_id is not null and public.is_trip_member(trip_id))
  with check (trip_id is not null and public.is_trip_member(trip_id));
create policy "expenses: supprimer voyage partage"
  on public.expenses for delete using (trip_id is not null and public.is_trip_member(trip_id));

-- Inviter : n'importe quel membre
create or replace function public.invite_trip_member(p_trip uuid, p_email text)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user uuid;
  v_name text;
begin
  if not public.is_trip_member(p_trip) then
    raise exception 'Seuls les membres du voyage peuvent inviter.' using errcode = '42501';
  end if;

  select u.id into v_user from auth.users u where lower(u.email) = lower(trim(p_email)) limit 1;
  if v_user is null then
    raise exception 'Aucun compte BuBuTravel avec cet email.' using errcode = 'P0002';
  end if;
  if v_user = auth.uid() then
    raise exception 'C''est votre propre compte.' using errcode = '22023';
  end if;

  insert into public.trip_members (trip_id, user_id) values (p_trip, v_user)
  on conflict do nothing;

  select coalesce(p.display_name, split_part(u.email, '@', 1)) into v_name
  from auth.users u left join public.profiles p on p.id = u.id
  where u.id = v_user;
  return v_name;
end
$function$;
revoke all on function public.invite_trip_member(uuid, text) from anon;

create or replace function public.add_trip_companion(p_trip uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not public.is_trip_member(p_trip) then
    raise exception 'Seuls les membres du voyage peuvent inviter.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.my_companions() c where c.user_id = p_user) then
    raise exception 'Cette personne n''a encore partage aucun voyage avec vous.' using errcode = '42501';
  end if;
  insert into public.trip_members (trip_id, user_id) values (p_trip, p_user) on conflict do nothing;
end
$function$;
revoke all on function public.add_trip_companion(uuid, uuid) from anon;

-- Quitter : chacun peut partir, personne ne retire l'autre
drop policy if exists "trip_members: retirer ou partir" on public.trip_members;
create policy "trip_members: retirer ou partir"
  on public.trip_members for delete using (user_id = auth.uid());

notify pgrst, 'reload schema';
