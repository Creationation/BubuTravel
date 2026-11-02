-- 022 : moteur IA choisi dans les reglages (auto, claude, chatgpt).
alter table public.profiles add column if not exists ai_provider text not null default 'auto';
alter table public.profiles drop constraint if exists profiles_ai_provider_check;
alter table public.profiles add constraint profiles_ai_provider_check check (ai_provider in ('auto', 'claude', 'chatgpt'));
notify pgrst, 'reload schema';
