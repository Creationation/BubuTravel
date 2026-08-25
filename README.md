# BuBuTravel

Carnet de voyage : pays et lieux visites, envies a venir, photos, parcours GPS
et carte interactive. Installable sur telephone, utilisable hors ligne.

React 19 + TypeScript + Vite + Tailwind v4, Supabase (Auth, Postgres, Storage),
Leaflet, Nominatim.

## Design

Boho premium. Terres cuites, ocre, sable et olive, formes en arche, grain de
papier. Titres en **Fraunces** avec l'axe `SOFT` ouvert, texte en **Karla**.
Deux themes complets, jour sable et nuit terre brulee, qui suivent la
preference systeme tant que rien n'est choisi. Tokens dans `src/index.css`.

## Mise en route

1. `npm install`
2. Dans Supabase, SQL Editor, executer **dans cet ordre** :
   - `supabase/schema.sql`
   - `supabase/migrations/002_trips_gallery_sharing.sql`
   - `supabase/migrations/003_lock_share_owner.sql`
   - `supabase/migrations/004_bucketlist_categories_planner.sql`

   Tous sont idempotents, ils peuvent etre rejoues.
3. `cp .env.example .env.local`, puis remplir `VITE_SUPABASE_URL` et
   `VITE_SUPABASE_ANON_KEY` (Project Settings > API).
4. Supabase > Authentication > URL Configuration : ajouter
   `http://localhost:5173` et l'URL de production aux Redirect URLs. Sans ca,
   les liens de confirmation et de reinitialisation sont refuses.
5. `npm run dev`

## Deploiement sur Vercel

1. Importer le depot `Creationation/BubuTravel`. Le framework Vite est detecte.
2. **Avant** de deployer, ajouter les variables d'environnement
   `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`. Vite les fige au build :
   ajoutees apres coup, il faut redeployer. Le prefixe `VITE_` est obligatoire,
   sans lui la variable n'arrive jamais au navigateur.
3. `vercel.json` contient la reecriture SPA, sans laquelle `/carte` renvoie 404
   au rechargement.
4. Apres le deploiement, reporter l'URL dans Supabase > Authentication >
   URL Configuration (Site URL et Redirect URLs).

## Ecrans

| Route | Contenu |
| --- | --- |
| `/` | Carnet : compteurs, voyages recents, passeport, chronologie |
| `/carte` | Carte, recherche et filtres, releve GPS, parcours |
| `/voyages`, `/voyages/:id` | Voyages passes et planificateur |
| `/bucketlist` | Les envies, filtrables par pays et categorie |
| `/galerie` | Toutes les photos, filtrables, avec visionneuse |
| `/profil` | Identite, theme, mot de passe, categories, partage, sauvegarde |
| `/p/:token` | Vue publique en lecture seule, sans compte |
| `/motdepasse` | Arrivee du lien de reinitialisation |

## Modele de donnees

| Table | Contenu |
| --- | --- |
| `profiles` | Nom affiche et avatar, cree par trigger a l'inscription |
| `places` | Lieu, `status` visited ou wishlist, categorie, voyage, coordonnees |
| `photos` | `place_id`, chemin de stockage, date d'envoi |
| `trips` | Voyage, `status` planning ou done, dates, couverture, pense-bete |
| `tracks` | Parcours GPS, points en jsonb, distance |
| `categories` | Categories libres, couleur, uniques par compte |
| `public_shares` | Jeton de partage, revocable |

RLS stricte partout : un compte ne lit et n'ecrit que ses propres lignes. Le
partage public ne passe pas par un assouplissement de la RLS mais par des
fonctions `security definer` qui exigent le jeton.

## Choix techniques

- **Leaflet plutot que Mapbox** : pas de cle API, pas de quota, licence BSD.
  Fond de carte CARTO, un style par theme, libre et sans compte.
- **Bucket `place-photos` prive**, chemin `{user_id}/{place_id}/{uuid}.{ext}`,
  affichage par URL signee valable 1 h. Les couvertures de voyage stockent le
  **chemin** et non l'URL signee, qui expirerait en une heure.
- **Compression avant envoi** (`browser-image-compression`), cote long a
  2200 px, avec `preserveExif` : l'app lit la date de prise de vue et la
  position GPS dans les metadonnees.
- **Traces GPS** en jsonb, sans PostGIS, avec filtre anti-bruit : sous 8 m de
  deplacement ou au-dela de 60 m de precision, le point est ignore, sinon un
  telephone immobile fabrique des centaines de metres.
- **PWA** : installable, tuiles de carte et polices en cache, invite de mise a
  jour explicite. Les URL signees sont en `NetworkOnly`, les mettre en cache
  afficherait des liens morts.

## Scripts

- `npm run dev` : serveur de developpement
- `npm run build` : typecheck, build de production et generation du service worker
- `npm run lint` : oxlint
- `node scripts/make-icons.mjs` : regenere les icones PWA
