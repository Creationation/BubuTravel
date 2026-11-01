-- ============================================================================
-- BuBuTravel  |  012 : photo d'illustration d'un lieu
--
-- Photo trouvee en ligne (Wikipedia / Wikimedia, sous licence libre) pour
-- rendre les listes plus vivantes. Distincte des photos des voyageurs.
-- null = pas encore cherchee ; '' = cherchee, rien de trouve.
--
-- Idempotent.
-- ============================================================================

alter table public.places add column if not exists image_url text;

notify pgrst, 'reload schema';
