-- 018 : contacts des hotes par hebergement, et ecran d'accueil du profil.
--
-- 1. trip_stops.hosts : liste des hebergements d'une etape avec le contact de
--    l'hote ([{ stay, name, phone, email, note }]). Une etape peut en avoir
--    plusieurs (Phuket : deux logements).
-- 2. profiles.greeting : ecran « Bonjour / Bonsoir » a l'ouverture de l'app,
--    'big' (grande photo), 'small' (petite photo) ou 'off'.

alter table public.trip_stops add column if not exists hosts jsonb not null default '[]'::jsonb;

alter table public.profiles add column if not exists greeting text not null default 'big';
alter table public.profiles drop constraint if exists profiles_greeting_check;
alter table public.profiles add constraint profiles_greeting_check check (greeting in ('big', 'small', 'off'));
