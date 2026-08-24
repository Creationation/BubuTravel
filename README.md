# BuBuTravel

Carnet de voyage : pays et lieux visites, photos et carte interactive.
React 19 + TypeScript + Vite + Tailwind v4, Supabase (Auth, Postgres, Storage), Leaflet.

## Design

Base **Gumroad** (noir, blanc, rose signature `#FF90E8`, bordures noires epaisses,
ombres dures sans flou, aucun degrade) avec une couche "de luxe" : fond papier creme,
titres en serif (Instrument Serif), plus d'air, ombres qui reagissent au survol.
Tokens dans `src/index.css`, bloc `@theme`.

## Mise en route

1. `npm install`
2. Creer un projet Supabase, puis coller `supabase/schema.sql` dans SQL Editor et l'executer.
   Le script cree les tables, les policies RLS, les buckets et le trigger `profiles`.
   Il est idempotent, il peut etre rejoue.
3. `cp .env.example .env.local` et remplir `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`
   (Dashboard Supabase > Project Settings > API).
4. Dans Supabase, *Authentication > URL Configuration*, ajouter `http://localhost:5173`
   aux Redirect URLs, sinon les liens de confirmation et de reset sont refuses.
5. `npm run dev`

## Modele de donnees

| Table      | Contenu                                                          |
| ---------- | ---------------------------------------------------------------- |
| `profiles` | 1 ligne par compte (nom affiche, avatar), creee par trigger       |
| `places`   | `user_id`, `name`, `country`, `lat`, `lng`, `visit_date`, `notes` |
| `photos`   | `place_id`, `user_id`, `url` (chemin storage), `uploaded_at`      |

Toutes les tables sont en RLS stricte : un compte ne lit et n'ecrit que ses propres lignes.
Le multi-utilisateur est en place des la v1, meme si l'app demarre a deux personnes.

## Stockage des photos

- Bucket `place-photos` **prive**, chemin `{user_id}/{place_id}/{uuid}.{ext}`.
  L'affichage passe par des URL signees valables 1 h, personne ne peut deviner une URL.
- Bucket `avatars` public, chemin `{user_id}/avatar.{ext}`.
- Dans les deux cas les policies storage exigent que le premier dossier soit l'uuid du compte.

## Carte : pourquoi Leaflet

Leaflet plutot que Mapbox : pas de cle API ni de compte a gerer, pas de quota de
chargements de carte a surveiller, licence BSD, et les tuiles OpenStreetMap suffisent
largement pour poser des marqueurs. Mapbox aurait un rendu plus fin et un geocodage
integre, au prix d'un token a stocker et d'une facturation a l'usage. Le geocodage passe
donc par Nominatim (OpenStreetMap), gratuit et sans cle, limite a 1 requete par seconde,
ce que `src/lib/geocode.ts` respecte.

## Scripts

- `npm run dev` : serveur de developpement
- `npm run build` : typecheck puis build de production
- `npm run lint` : oxlint
