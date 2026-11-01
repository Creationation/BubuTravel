-- ============================================================================
-- BuBuTravel  |  008 : voyages partages, etapes, documents, a faire
--
-- Pour un long voyage a deux (Thailande + Vietnam, dec. 2026 a fev. 2027) :
--   1. trip_members  : un voyage peut etre partage avec un autre compte.
--                      Tout ce qui est rattache au voyage devient visible et
--                      modifiable par les deux : lieux, photos, parcours,
--                      evenements, etapes, documents, a faire.
--   2. trip_stops    : l'itineraire par etapes (ville, dates, hebergement,
--                      transport vers l'etape suivante).
--   3. trip_documents: le coffre (passeport, visas, billets...), fichiers dans
--                      le bucket prive trip-docs, chemin {trip_id}/...
--   4. trip_todos    : les choses a faire, avec date et rappel. Reprend
--                      l'ancien pense-bete (trips.checklist).
--
-- Les heures des etapes et des a faire sont en `timestamp` SANS fuseau :
-- c'est l'heure locale du pays (« le vol part a 10 h 30 a Bangkok »), et
-- c'est exactement ce que le calendrier du telephone doit afficher.
--
-- Idempotent : rejouable sans casse.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. MEMBRES D'UN VOYAGE
-- ---------------------------------------------------------------------------
create table if not exists public.trip_members (
  trip_id   uuid not null references public.trips (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  added_at  timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create index if not exists trip_members_user_idx on public.trip_members (user_id);

alter table public.trip_members enable row level security;

/**
 * Proprietaire ou membre du voyage. security definer : la fonction est
 * appelee DEPUIS les policies de trips et de trip_members, elle doit lire ces
 * tables sans repasser par leurs policies, sinon recursion infinie.
 */
create or replace function public.is_trip_member(p_trip uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $function$
  select p_trip is not null and (
    exists (select 1 from public.trips t where t.id = p_trip and t.user_id = auth.uid())
    or exists (select 1 from public.trip_members m where m.trip_id = p_trip and m.user_id = auth.uid())
  )
$function$;

/** Meme chose a partir d'un chemin de fichier {trip_id}/... du bucket trip-docs. */
create or replace function public.is_trip_folder_member(p_name text)
returns boolean
language sql
security definer
stable
set search_path = public
as $function$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.is_trip_member(split_part(p_name, '/', 1)::uuid)
    else false
  end
$function$;

/** Une photo du bucket place-photos appartient-elle a un lieu d'un voyage partage ? */
create or replace function public.can_read_shared_photo(p_name text)
returns boolean
language sql
security definer
stable
set search_path = public
as $function$
  select exists (
    select 1
    from public.photos ph
    join public.places pl on pl.id = ph.place_id
    where ph.url = p_name and public.is_trip_member(pl.trip_id)
  )
$function$;

drop policy if exists "trip_members: voir ceux du voyage"   on public.trip_members;
drop policy if exists "trip_members: retirer ou partir"     on public.trip_members;

create policy "trip_members: voir ceux du voyage"
  on public.trip_members for select using (public.is_trip_member(trip_id));

-- Le proprietaire retire quelqu'un, ou un membre quitte le voyage lui-meme
create policy "trip_members: retirer ou partir"
  on public.trip_members for delete using (
    user_id = auth.uid()
    or exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid())
  );

-- Pas de policy insert : l'ajout passe par invite_trip_member, qui verifie
-- que l'appelant est le proprietaire et retrouve le compte par son email.

/**
 * Invite un compte existant par son email. Renvoie son nom affiche.
 * L'email n'est jamais expose : la recherche se fait cote serveur.
 */
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
  if not exists (select 1 from public.trips t where t.id = p_trip and t.user_id = auth.uid()) then
    raise exception 'Seul le proprietaire du voyage peut inviter.' using errcode = '42501';
  end if;

  select u.id into v_user from auth.users u where lower(u.email) = lower(trim(p_email)) limit 1;
  if v_user is null then
    raise exception 'Aucun compte BuBuTravel avec cet email. La personne doit d''abord creer son compte.'
      using errcode = 'P0002';
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

/** Les personnes d'un voyage : proprietaire puis membres, sans email. */
create or replace function public.trip_people(p_trip uuid)
returns table (user_id uuid, display_name text, avatar_url text, is_owner boolean)
language sql
security definer
stable
set search_path = public
as $function$
  select x.user_id, coalesce(p.display_name, 'Voyageur'), p.avatar_url, x.is_owner
  from (
    select t.user_id, true as is_owner from public.trips t where t.id = p_trip
    union
    select m.user_id, false from public.trip_members m where m.trip_id = p_trip
  ) x
  left join public.profiles p on p.id = x.user_id
  where public.is_trip_member(p_trip)
  order by x.is_owner desc, p.display_name
$function$;

revoke all on function public.trip_people(uuid) from anon;

-- ---------------------------------------------------------------------------
-- 2. CE QUI EXISTE DEJA DEVIENT VISIBLE PAR LES MEMBRES DU VOYAGE
--    Policies AJOUTEES a cote des anciennes (elles se combinent en OU) :
--    le carnet personnel reste prive, seul ce qui est rattache a un voyage
--    partage s'ouvre.
-- ---------------------------------------------------------------------------
drop policy if exists "trips: lire les partages"     on public.trips;
drop policy if exists "trips: modifier les partages" on public.trips;
create policy "trips: lire les partages"
  on public.trips for select using (public.is_trip_member(id));
create policy "trips: modifier les partages"
  on public.trips for update using (public.is_trip_member(id)) with check (public.is_trip_member(id));

drop policy if exists "places: lire voyage partage"     on public.places;
drop policy if exists "places: modifier voyage partage" on public.places;
create policy "places: lire voyage partage"
  on public.places for select using (public.is_trip_member(trip_id));
create policy "places: modifier voyage partage"
  on public.places for update using (public.is_trip_member(trip_id))
  with check (auth.uid() = user_id or public.is_trip_member(trip_id));

drop policy if exists "photos: lire voyage partage" on public.photos;
create policy "photos: lire voyage partage"
  on public.photos for select using (
    exists (select 1 from public.places pl where pl.id = place_id and public.is_trip_member(pl.trip_id))
  );

drop policy if exists "tracks: lire voyage partage" on public.tracks;
create policy "tracks: lire voyage partage"
  on public.tracks for select using (public.is_trip_member(trip_id));

drop policy if exists "events: lire voyage partage"     on public.events;
drop policy if exists "events: modifier voyage partage" on public.events;
create policy "events: lire voyage partage"
  on public.events for select using (public.is_trip_member(trip_id));
create policy "events: modifier voyage partage"
  on public.events for update using (public.is_trip_member(trip_id))
  with check (auth.uid() = user_id or public.is_trip_member(trip_id));

drop policy if exists "photos: lire voyage partage" on storage.objects;
create policy "photos: lire voyage partage"
  on storage.objects for select
  using (bucket_id = 'place-photos' and public.can_read_shared_photo(name));

-- ---------------------------------------------------------------------------
-- 3. ETAPES DE L'ITINERAIRE
-- ---------------------------------------------------------------------------
create table if not exists public.trip_stops (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references public.trips (id) on delete cascade,
  created_by    uuid references auth.users (id) on delete set null default auth.uid(),
  position      integer not null default 0,

  name          text not null,
  country       text,
  lat           double precision,
  lng           double precision,
  arrive_date   date,
  leave_date    date,

  stay_name     text,
  stay_address  text,
  stay_ref      text,
  stay_url      text,

  /** Transport pour rejoindre l'etape SUIVANTE. */
  transport_mode     text,
  transport_details  text,
  transport_departs  timestamp,
  transport_arrives  timestamp,
  transport_ref      text,

  notes         text,
  created_at    timestamptz not null default now()
);

create index if not exists trip_stops_trip_idx on public.trip_stops (trip_id, position);

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'trip_stops_dates_check') then
    alter table public.trip_stops add constraint trip_stops_dates_check
      check (leave_date is null or arrive_date is null or leave_date >= arrive_date);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'trip_stops_mode_check') then
    alter table public.trip_stops add constraint trip_stops_mode_check
      check (transport_mode is null or transport_mode in
        ('plane', 'train', 'bus', 'boat', 'car', 'taxi', 'motorbike', 'other'));
  end if;
end
$do$;

alter table public.trip_stops enable row level security;

drop policy if exists "trip_stops: membres" on public.trip_stops;
create policy "trip_stops: membres"
  on public.trip_stops for all
  using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));

-- ---------------------------------------------------------------------------
-- 4. A FAIRE ET RAPPELS
-- ---------------------------------------------------------------------------
create table if not exists public.trip_todos (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips (id) on delete cascade,
  stop_id     uuid references public.trip_stops (id) on delete set null,
  created_by  uuid references auth.users (id) on delete set null default auth.uid(),

  title       text not null,
  notes       text,
  /** todo, booking (a reserver), admin (visa, assurance...), packing (valise) */
  kind        text not null default 'todo',
  /** Echeance en heure locale. Sans heure : a minuit, traite comme « dans la journee ». */
  due_at      timestamp,
  has_time    boolean not null default false,
  /** Minutes avant l'echeance pour l'alarme du calendrier, null = pas d'alarme. */
  remind_minutes integer,

  done        boolean not null default false,
  done_by     uuid references auth.users (id) on delete set null,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists trip_todos_trip_idx on public.trip_todos (trip_id, done, due_at);

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'trip_todos_kind_check') then
    alter table public.trip_todos add constraint trip_todos_kind_check
      check (kind in ('todo', 'booking', 'admin', 'packing'));
  end if;
end
$do$;

alter table public.trip_todos enable row level security;

drop policy if exists "trip_todos: membres" on public.trip_todos;
create policy "trip_todos: membres"
  on public.trip_todos for all
  using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));

-- L'ancien pense-bete (jsonb dans trips.checklist) passe dans trip_todos.
-- Les identifiants sont repris, donc rejouer ne cree pas de doublon.
insert into public.trip_todos (id, trip_id, created_by, title, done, kind, position)
select (item->>'id')::uuid, t.id, t.user_id, item->>'text',
       coalesce((item->>'done')::boolean, false), 'todo', (ord - 1)::int
from public.trips t,
     jsonb_array_elements(coalesce(t.checklist, '[]'::jsonb)) with ordinality as x(item, ord)
where jsonb_typeof(t.checklist) = 'array'
  and (item->>'id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and coalesce(item->>'text', '') <> ''
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 5. DOCUMENTS
-- ---------------------------------------------------------------------------
create table if not exists public.trip_documents (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips (id) on delete cascade,
  stop_id     uuid references public.trip_stops (id) on delete set null,
  created_by  uuid references auth.users (id) on delete set null default auth.uid(),

  /** passport, visa, flight, transport, stay, insurance, health, money, other */
  kind        text not null default 'other',
  title       text not null,
  /** A qui il appartient (« Diego », « nous deux »...). */
  holder      text,
  /** Numero de reservation, de vol, de police d'assurance... */
  reference   text,
  doc_date    date,
  valid_until date,
  notes       text,

  /** Chemin dans le bucket prive trip-docs : {trip_id}/{uuid}-{nom}. */
  path        text,
  file_name   text,
  mime        text,
  size_bytes  bigint,

  created_at  timestamptz not null default now()
);

create index if not exists trip_documents_trip_idx on public.trip_documents (trip_id, kind);

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'trip_documents_kind_check') then
    alter table public.trip_documents add constraint trip_documents_kind_check
      check (kind in ('passport', 'visa', 'flight', 'transport', 'stay', 'insurance',
                      'health', 'money', 'other'));
  end if;
end
$do$;

alter table public.trip_documents enable row level security;

drop policy if exists "trip_documents: membres" on public.trip_documents;
create policy "trip_documents: membres"
  on public.trip_documents for all
  using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));

insert into storage.buckets (id, name, public, file_size_limit)
values ('trip-docs', 'trip-docs', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;

drop policy if exists "trip-docs: lire"     on storage.objects;
drop policy if exists "trip-docs: ecrire"   on storage.objects;
drop policy if exists "trip-docs: supprimer" on storage.objects;

create policy "trip-docs: lire"
  on storage.objects for select
  using (bucket_id = 'trip-docs' and public.is_trip_folder_member(name));
create policy "trip-docs: ecrire"
  on storage.objects for insert
  with check (bucket_id = 'trip-docs' and public.is_trip_folder_member(name));
create policy "trip-docs: supprimer"
  on storage.objects for delete
  using (bucket_id = 'trip-docs' and public.is_trip_folder_member(name));

-- ---------------------------------------------------------------------------
-- 6. IDEES : liens TikTok / Instagram / YouTube / Google Maps a analyser
--    L'app cree la ligne (status pending). L'analyseur (programme Python sur
--    le PC, plus tard sur un VPS) la prend, telecharge la video en 480p,
--    extrait les images, transcrit la voix, cherche sur le web, puis ecrit
--    le resultat dans `analysis` (status ready).
--    Sans voyage (trip_id null), l'idee vit dans la wishlist.
-- ---------------------------------------------------------------------------
create table if not exists public.link_ideas (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade default auth.uid(),
  trip_id     uuid references public.trips (id) on delete set null,

  url         text not null,
  platform    text,
  /** Precisions tapees par l'utilisateur (« tour en bateau au lever du soleil »). */
  note        text,

  /** pending, processing, ready, error, archived */
  status      text not null default 'pending',
  error       text,
  attempts    integer not null default 0,

  title       text,
  thumbnail   text,
  /** Resultat structure de l'analyse, voir src/lib/ideas.ts */
  analysis    jsonb,
  /** Lieu cree quand l'idee a ete ajoutee au voyage ou aux envies. */
  place_id    uuid references public.places (id) on delete set null,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists link_ideas_user_idx   on public.link_ideas (user_id, created_at desc);
create index if not exists link_ideas_trip_idx   on public.link_ideas (trip_id);
create index if not exists link_ideas_status_idx on public.link_ideas (status, created_at);

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'link_ideas_status_check') then
    alter table public.link_ideas add constraint link_ideas_status_check
      check (status in ('pending', 'processing', 'ready', 'error', 'archived'));
  end if;
end
$do$;

alter table public.link_ideas enable row level security;

drop policy if exists "link_ideas: lire"      on public.link_ideas;
drop policy if exists "link_ideas: creer"     on public.link_ideas;
drop policy if exists "link_ideas: modifier"  on public.link_ideas;
drop policy if exists "link_ideas: supprimer" on public.link_ideas;

create policy "link_ideas: lire"
  on public.link_ideas for select
  using (auth.uid() = user_id or public.is_trip_member(trip_id));
create policy "link_ideas: creer"
  on public.link_ideas for insert
  with check (auth.uid() = user_id and (trip_id is null or public.is_trip_member(trip_id)));
create policy "link_ideas: modifier"
  on public.link_ideas for update
  using (auth.uid() = user_id or public.is_trip_member(trip_id))
  with check (auth.uid() = user_id or public.is_trip_member(trip_id));
create policy "link_ideas: supprimer"
  on public.link_ideas for delete
  using (auth.uid() = user_id or public.is_trip_member(trip_id));

-- Etat de l'analyseur : l'app affiche « analyseur en ligne / hors ligne ».
-- Une seule ligne par machine, ecrite par l'analyseur avec la cle service.
create table if not exists public.analyzer_status (
  id          text primary key,
  last_seen   timestamptz not null default now(),
  version     text
);

alter table public.analyzer_status enable row level security;

drop policy if exists "analyzer_status: lire" on public.analyzer_status;
create policy "analyzer_status: lire"
  on public.analyzer_status for select using (auth.uid() is not null);

-- Les deux voyageurs voient les idees de l'autre arriver sans recharger
do $do$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'link_ideas'
  ) then
    alter publication supabase_realtime add table public.link_ideas;
  end if;
end
$do$;

-- PostgREST relit le schema tout de suite, sans attendre
notify pgrst, 'reload schema';
