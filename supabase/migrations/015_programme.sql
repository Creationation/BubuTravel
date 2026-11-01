-- ============================================================================
-- BuBuTravel  |  015 : programme du voyage
--
-- Une chose a faire peut etre placee dans le voyage : un jour (visit_date,
-- deja existant), une heure de debut et une duree. Sert a construire le
-- programme jour par jour et a detecter les chevauchements.
--
-- Idempotent.
-- ============================================================================

alter table public.places add column if not exists plan_time text;
alter table public.places add column if not exists plan_minutes integer;

notify pgrst, 'reload schema';
