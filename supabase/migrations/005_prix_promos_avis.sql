-- ============================================================================
-- BuBuTravel  |  migration 005
-- Ce que le lieu a coute, sa fourchette de prix, les promotions, et l'avis.
-- A coller dans Supabase > SQL Editor > New query > Run.
-- Idempotent : peut etre rejoue sans casse.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. LIEUX : argent et avis
--    cost en numeric et non en float : un montant ne doit pas subir les
--    arrondis du binaire, 0.1 + 0.2 ne fait pas 0.3 en double precision.
-- ---------------------------------------------------------------------------
alter table public.places add column if not exists cost numeric(12, 2);
alter table public.places add column if not exists currency text not null default 'EUR';
alter table public.places add column if not exists price_level smallint;
alter table public.places add column if not exists promo_code text;
alter table public.places add column if not exists promo_note text;
alter table public.places add column if not exists promo_until date;
alter table public.places add column if not exists rating smallint;
alter table public.places add column if not exists review text;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'places_price_level_check') then
    alter table public.places
      add constraint places_price_level_check
      check (price_level is null or price_level between 1 and 4);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'places_rating_check') then
    alter table public.places
      add constraint places_rating_check
      check (rating is null or rating between 1 and 5);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'places_cost_check') then
    alter table public.places
      add constraint places_cost_check check (cost is null or cost >= 0);
  end if;
end
$do$;

create index if not exists places_rating_idx on public.places (user_id, rating desc nulls last);

-- ---------------------------------------------------------------------------
-- 2. PARTAGE : exposer les nouvelles colonnes
--    La signature de sortie change, il faut supprimer avant de recreer.
--    Le montant depense reste PRIVE : un visiteur voit la fourchette, l'avis
--    et la promotion, jamais ce qui a ete paye.
-- ---------------------------------------------------------------------------
drop function if exists public.shared_places(text);

create function public.shared_places(share_token text)
returns table (
  id uuid, name text, country text, city text,
  lat double precision, lng double precision,
  visit_date date, notes text, trip_id uuid,
  status text, category_id uuid, planned_order integer,
  price_level smallint, rating smallint, review text,
  promo_note text, promo_code text, promo_until date
)
language sql
security definer
stable
set search_path = public
as $function$
  select pl.id, pl.name, pl.country, pl.city, pl.lat, pl.lng,
         pl.visit_date, pl.notes, pl.trip_id,
         pl.status, pl.category_id, pl.planned_order,
         pl.price_level, pl.rating, pl.review,
         pl.promo_note, pl.promo_code, pl.promo_until
  from public.places pl
  where pl.user_id = public.share_owner(share_token)
  order by pl.visit_date desc nulls last
$function$;

grant execute on function public.shared_places(share_token text) to anon, authenticated;
-- Une fonction recreee repart avec EXECUTE accorde a PUBLIC, ce qui n'est pas
-- voulu : seuls anon et authenticated doivent pouvoir l'appeler.
revoke execute on function public.shared_places(share_token text) from public;
