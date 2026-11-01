-- ============================================================================
-- BuBuTravel  |  014 : fiche detaillee d'un lieu
--
-- Infos pratiques trouvees par l'analyseur (video analysee ou recherche web) :
-- resume, prix, horaires, plats et menu, reservation, conseils, images.
--
-- Idempotent.
-- ============================================================================

alter table public.places add column if not exists details jsonb;

notify pgrst, 'reload schema';
