-- ============================================================================
-- BuBuTravel  |  013 : galerie d'images des lieux et des idees
--
-- Images tirees des videos analysees (TikTok, Instagram, YouTube) : elles
-- montrent le vrai endroit, contrairement a une recherche d'image au hasard.
-- Stockees dans le bucket public idea-frames (contenu deja public a
-- l'origine), ecrit uniquement par l'analyseur (cle service).
--
-- Idempotent.
-- ============================================================================

alter table public.places add column if not exists gallery jsonb not null default '[]'::jsonb;
alter table public.link_ideas add column if not exists frames jsonb not null default '[]'::jsonb;

insert into storage.buckets (id, name, public, file_size_limit)
values ('idea-frames', 'idea-frames', true, 2097152)
on conflict (id) do update set public = true;

notify pgrst, 'reload schema';
