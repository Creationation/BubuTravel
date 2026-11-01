-- ============================================================================
-- BuBuTravel  |  016 : avis par voyageur, compagnons de voyage
--
-- 1. places.feedback : l'avis de chaque voyageur sur un lieu visite,
--    { "<user_id>": { name, price, service, vibe, again, comment, at } }.
--    Chacun ecrit le sien via set_place_feedback (pas d'ecrasement de l'avis
--    de l'autre), lisible par les membres du voyage.
-- 2. add_trip_companion : ajouter en un tap une personne avec qui on a deja
--    voyage (sans retaper son email).
-- 3. my_companions : les personnes avec qui on partage au moins un voyage.
--
-- Idempotent.
-- ============================================================================

alter table public.places add column if not exists feedback jsonb not null default '{}'::jsonb;

create or replace function public.set_place_feedback(p_place uuid, p_feedback jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_place public.places;
  v_name text;
  v_out jsonb;
begin
  select * into v_place from public.places where id = p_place;
  if v_place.id is null then
    raise exception 'Lieu introuvable' using errcode = 'P0002';
  end if;
  if not (v_place.user_id = auth.uid() or public.is_trip_member(v_place.trip_id)) then
    raise exception 'Acces refuse' using errcode = '42501';
  end if;
  select coalesce(display_name, 'Voyageur') into v_name from public.profiles where id = auth.uid();
  update public.places
     set feedback = coalesce(feedback, '{}'::jsonb)
                    || jsonb_build_object(auth.uid()::text, p_feedback || jsonb_build_object('name', v_name, 'at', now()))
   where id = p_place
  returning feedback into v_out;
  return v_out;
end
$function$;

revoke all on function public.set_place_feedback(uuid, jsonb) from anon;

create or replace function public.my_companions()
returns table (user_id uuid, display_name text, avatar_url text)
language sql
security definer
stable
set search_path = public
as $function$
  with mine as (
    select t.id from public.trips t where t.user_id = auth.uid()
    union
    select m.trip_id from public.trip_members m where m.user_id = auth.uid()
  ), people as (
    select t.user_id from public.trips t where t.id in (select id from mine)
    union
    select m.user_id from public.trip_members m where m.trip_id in (select id from mine)
  )
  select p.id, coalesce(p.display_name, 'Voyageur'), p.avatar_url
  from public.profiles p
  where p.id in (select user_id from people) and p.id <> auth.uid()
$function$;

revoke all on function public.my_companions() from anon;

create or replace function public.add_trip_companion(p_trip uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not exists (select 1 from public.trips t where t.id = p_trip and t.user_id = auth.uid()) then
    raise exception 'Seul l''organisateur du voyage peut inviter.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.my_companions() c where c.user_id = p_user) then
    raise exception 'Cette personne n''a encore partage aucun voyage avec vous : invitez-la par email.' using errcode = '42501';
  end if;
  insert into public.trip_members (trip_id, user_id) values (p_trip, p_user) on conflict do nothing;
end
$function$;

revoke all on function public.add_trip_companion(uuid, uuid) from anon;

notify pgrst, 'reload schema';
