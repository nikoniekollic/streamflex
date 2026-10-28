# MEMORY — Journal de bord

## Étape 1 — Init frontend (2026-10-28)
### Terminé
- `.claudeignore`, `.gitignore`, `ARCHITECTURE.md`
- `apps/web` : Vite 6 + React 19 + TS strict, alias `@/*`
- TanStack Router : plugin Vite (`tanstackRouter`, autoCodeSplitting), `__root.tsx` avec contexte `{ supabase }`, route `/` avec loader `getSession()`, devtools en DEV
- Tailwind v4 (`@tailwindcss/vite`) + thème Shadcn (dark, primary rouge) dans `src/index.css`
- Shadcn : `components.json` (new-york), `lib/utils.ts` (`cn`), `components/ui/button.tsx`
- Supabase : `lib/env.ts` (validation env), `lib/supabase.ts` (PKCE, persistSession), `.env.example`

### En cours / non vérifié
- `npm install` + `npm run dev` NON exécutés (registre npm inaccessible depuis le sandbox cloud) → à valider en local.
- `src/routeTree.gen.ts` sera généré au premier `npm run dev`.

### Prochaine action
1. En local : `cd apps/web && cp .env.example .env.local` (renseigner URL + clé Supabase) → `npm install` → `npm run dev` → vérifier « Supabase : connecté ».
2. ~~Étape 2~~ → fait (voir ci-dessous).

## Étape 2 — Schéma BDD + RLS (2026-10-28) ✅ BDD PRÊTE
### Terminé
- `supabase/migrations/0001_initial_schema.sql` :
  - Enums : `user_role`, `title_type` (movie/series), `video_provider` (pixeldrain/onefichier/alist/other), `video_quality`
  - Tables : `profiles` (auto-créé via trigger `on_auth_user_created`), `genres`, `titles` (films+séries, `metadata` jsonb, `search` tsvector + trigram), `title_genres`, `seasons`, `episodes`, `media_sources` (title_id XOR episode_id, `external_id`/`raw_url`, priorité, statut), `watch_progress` (unique user/title/episode, `completed` généré ≥ 92 %)
  - Intégrité : FK composites (episode↔title), triggers `assert_title_type` (saisons → séries, sources directes → films)
  - RLS : catalogue lisible par `authenticated` si `is_published` (admin : tout) ; écriture catalogue admin ; `profiles` & `watch_progress` propriétaire uniquement ; `media_sources` admin seulement (resolver = `service_role`) ; `anon` sans accès
  - Grants par colonne : l'utilisateur ne peut pas modifier `profiles.role` ni `watch_progress.user_id`
  - RPC : `is_admin()`, `get_available_qualities(p_title_id, p_episode_id)` (qualités/langues sans IDs bruts)
- Validé sur PostgreSQL 16 local (stub `auth`) : migration OK + tests RLS/contraintes OK
- `apps/web/src/types/database.ts` (format `supabase gen types`) ; client typé `TypedSupabaseClient` dans `lib/supabase.ts` et contexte router

### À faire côté utilisateur
- Appliquer la migration : `supabase link --project-ref <ref>` puis `supabase db push` (ou coller le SQL dans le SQL Editor)
- Se promouvoir admin : `update public.profiles set role='admin' where id='<uuid>';`
- Optionnel : régénérer les types : `npx supabase gen types typescript --project-id <ref> --schema public > apps/web/src/types/database.ts`
- Toujours à valider : `npm install` + `npm run dev` (étape 1)

### Prochaine action — Étape 3 : Auth + navigation
- Pages `/login` & `/signup` (Supabase Auth email + OAuth), route layout protégée `_authed` (redirect via `beforeLoad` si pas de session), écoute `onAuthStateChange` + invalidation router
- Composants Shadcn : `input`, `label`, `card`, `form`, `sonner`
- Ensuite étape 4 : pages catalogue (`/browse`, `/title/$slug`) branchées sur le schéma

## Étape 3 — Authentification (2026-10-28) ✅ AUTH FINALISÉE
### Terminé
- Deps ajoutées (`package.json`) : `react-hook-form`, `@hookform/resolvers`, `zod`, `@radix-ui/react-label`
- Shadcn (écrits manuellement, style new-york) : `ui/card`, `ui/form`, `ui/input`, `ui/label`, `ui/alert`
- `lib/auth.ts` : schémas zod `loginSchema`/`registerSchema`, `authErrorMessage` (codes Supabase → FR), `safeRedirect` (anti open-redirect), `validateRedirectSearch`
- Routes (file-based) :
  - `__root.tsx` : `beforeLoad` → `getSession()` → `context.session` ; header (nav + déconnexion)
  - `_guest.tsx` (layout pathless, fond Netflix) : session présente → redirect `?redirect` ou `/`
  - `_guest/login.tsx` → `/login` (`signInWithPassword`)
  - `_guest/register.tsx` → `/register` (`signUp`, `full_name` → trigger profil, écran « vérifie ta boîte mail » si confirmation requise)
  - `_authed.tsx` (layout protégé) : pas de session → `/login?redirect=<href>` ; expose `context.user`
  - `_authed/index.tsx` → `/` (accueil), `_authed/browse.tsx` → `/browse` (grille `titles`, `.range()` en dernier)
- `main.tsx` : `onAuthStateChange` (SIGNED_IN/SIGNED_OUT/USER_UPDATED) → `router.invalidate()` (différé via `setTimeout`)
- `routes/index.tsx` supprimé (remplacé par `_authed/index.tsx`)

### Non vérifié
- Compilation / `npm run dev` toujours non exécutés (registre npm inaccessible dans le sandbox) → valider en local
- Supabase Dashboard : Auth → URL Configuration → ajouter `http://localhost:5173/login` aux Redirect URLs

### Prochaine action — Étape 4 : Carrousel page d'accueil
- Composant `components/catalog/TitleCarousel.tsx` (rangée horizontale scroll-snap, flèches prev/next, hover zoom, lazy images, skeleton)
- Section `HeroBanner` (backdrop + logo + CTA « Lecture »)
- Accueil `_authed/index.tsx` : rangées « Reprendre » (`watch_progress`), « Nouveautés », par genre (`title_genres`) — requêtes paginées légères

## Étape 4 — Page d'accueil (2026-10-28) ✅ ACCUEIL FINALISÉ
### Terminé
- `components/ui/carousel.tsx` : API Shadcn (`Carousel`, `CarouselContent`, `CarouselItem`, `CarouselPrevious`, `CarouselNext`, `useCarousel`) en scroll natif (`overflow-x-auto` + `snap-x`), flèches au survol, clavier ←/→, `ResizeObserver` — sans Embla (npm bloqué ; remplaçable par `npx shadcn add carousel` sans changer les appels)
- `index.css` : utilitaire `scrollbar-none`
- `components/catalog/MovieCard.tsx` : variantes `poster` (2/3) / `backdrop` (16/9), hover `scale-105` + ring + overlay infos, barre de progression, `MovieCardSkeleton`
- `components/catalog/HeroBanner.tsx` : backdrop plein écran (`-mt-16` sous le header), titre/logo, métadonnées, CTA « Lecture » (`/title/$slug?play=true`) + « Plus d'infos »
- `components/catalog/CategoryCarousel.tsx` : `CategoryCarousel`, `ContinueWatchingCarousel`, `CategoryCarouselSkeleton`
- `lib/catalog.ts` : `fetchHome()` — 3 requêtes parallèles (`titles` publiés + `title_genres(genres)` limit 60, `genres`, `watch_progress` non terminés + `titles`), `.range()` en dernier ; `buildRows()` → Tendances, une rangée par genre (≥4 titres), Séries, Films ; hero aléatoire parmi les 10 plus récents avec backdrop
- `lib/mock-catalog.ts` : 30 titres / 6 genres / 5 progressions mockés (schéma `titles`, images picsum) — utilisés seulement si aucun titre publié
- `routes/_authed/index.tsx` : loader `fetchHome`, `staleTime` 60 s, `pendingComponent` skeleton, bandeau « données de démonstration »
- `routes/_authed/title.$slug.tsx` : stub (search `play?: boolean`) pour typer les liens

### Non vérifié
- Compilation / rendu toujours non exécutés (npm inaccessible dans le sandbox) → `npm install && npm run dev` en local

### Prochaine action — Étape 5 : Page de détail + lecteur vidéo
- `title.$slug.tsx` : loader titre + genres + saisons/épisodes (séries), sélecteur de saison, liste d'épisodes avec progression
- Lecteur `components/player/VideoPlayer.tsx` (HTML5 `<video>`, contrôles custom, plein écran, reprise à `position_seconds`, sauvegarde `watch_progress` throttlée ~10 s + à la pause/fermeture)
- Résolution du flux : Edge Function `resolve-stream` (service_role → `media_sources` par priorité → Pixeldrain direct / 1fichier via Alldebrid → cache Redis), qualités via RPC `get_available_qualities`

## Étape 5 — Lecteur vidéo + streaming distribué (2026-10-28) ✅ LECTEUR FINALISÉ
### Terminé
- **Restructuration routes** : `__root` (session only) → `_authed` (garde) → `_authed/_shell` (header `components/layout/AppHeader.tsx` + `pt-16`) contient `/`, `/browse`, `/title/$slug` ; `_authed/watch.$id.tsx` hors shell (plein écran) ; logo ajouté dans `_guest`
- **Migration `0002_save_progress.sql`** : RPC `save_progress(p_title_id, p_episode_id, p_position_seconds, p_duration_seconds)` (security invoker, upsert `on conflict (user_id,title_id,episode_id)` ne modifiant que position/durée) + index `media_sources_lookup_idx` — testé PG16 (upsert, completed, RLS titre non publié, anon refusé) ; type ajouté à `database.ts`
- **Edge Function `supabase/functions/resolve-stream`** (Deno) :
  - JWT utilisateur vérifié, titre/épisode contrôlés via RLS (publié), `media_sources` lus en `service_role` (filtre `.or("is_active.is.null,is_active.eq.true")`)
  - Tri : qualité demandée → meilleure qualité → `priority` ; fallback multi-source ; `exclude[]` ; `refresh` (bypass cache)
  - `_shared/providers.ts` : Pixeldrain → `https://pixeldrain.com/api/file/{id}` (vérif `/info`, clé Basic optionnelle, TTL 6 h) ; 1fichier → Alldebrid `GET /v4/link/unlock` (Bearer + `agent`, gestion `delayed` via `/v4/link/delayed`, TTL 2 h) ; alist/other → `raw_url`
  - `_shared/redis.ts` : cache Upstash REST `stream:{source_id}` (no-op si non configuré) ; `last_status`/`last_checked_at` mis à jour
  - Secrets : `supabase/functions/.env.example` (`ALLDEBRID_API_KEY`, `ALLDEBRID_AGENT`, `PIXELDRAIN_API_KEY`, `UPSTASH_REDIS_REST_URL/TOKEN`, `ALLOWED_ORIGIN`)
- **Front** :
  - `lib/stream.ts` : `resolveStream()` (`functions.invoke`, codes d'erreur FR), `loadWatch()` (titre, épisodes triés saison/épisode, dernier épisode vu, épisode suivant, position de reprise), `formatTime`
  - `hooks/useWatchProgress.ts` : sauvegarde silencieuse via RPC toutes les 15 s (delta ≥ 2 s) + pause, fin, `visibilitychange`, `pagehide`, unmount
  - `components/player/VideoPlayer.tsx` : `<video>` + contrôles Tailwind/lucide (lecture/pause, ±10 s, volume persistant localStorage, seek bar pointer + buffer + tooltip, temps, plein écran + fallback iOS, qualité, épisode suivant < 30 s, auto-hide 3 s, raccourcis espace/k/j/l/←/→/↑/↓/m/f/Échap, spinner)
  - `routes/_authed/watch.$id.tsx` → `/watch/$id?episode=&t=` : loader `loadWatch` (staleTime 0), erreur lecteur → 1 refresh puis bascule de source, changement de qualité à la position courante, enchaînement auto épisode suivant
  - Hero « Lecture » et cartes « Reprendre la lecture » → `/watch/$id`
- Vérif syntaxique (parser TS) OK sur tout `src/` et `supabase/functions/`

### À faire côté utilisateur
- `supabase db push` (0002) ; `supabase secrets set --env-file supabase/functions/.env` ; `supabase functions deploy resolve-stream`
- Toujours : `npm install && npm run dev` (typecheck complet non exécuté — npm bloqué dans le sandbox)
- Les données mockées n'ont pas de `media_sources` → le lecteur affichera « Aucune source vidéo » tant que le catalogue réel est vide

### Prochaine action — Étape 6 : Pipeline Python d'upload automatisé (`pipelines/`)
- Watcher dossier `media/inbox` → probe `ffprobe` (durée, codecs, résolution → `quality`) → remux/transcode H.264/AAC MP4 faststart si navigateur-incompatible
- Upload Pixeldrain (`PUT /api/file/{name}`, clé API) + 1fichier (API upload) avec retries/backoff, checksum
- Enrichissement métadonnées TMDB → upsert `titles`/`seasons`/`episodes` + insert `media_sources` (service_role), nommage `Titre (Année)` / `Série S01E02`
- CLI (`typer`) + config `.env`, logs structurés, idempotence (checksum déjà présent → skip)

## Étape 6 — Pipeline Python d'upload (2026-10-28) ✅ PIPELINE CRÉÉ
### Terminé (`pipelines/`)
- `requirements.txt` (`aiohttp`, `supabase`), `.env.example`, `setup.sh` / `setup.ps1` (création `.venv` + install + copie `.env`)
- `sfpipe/config.py` : chargeur `.env` sans dépendance, `Settings` (clés, concurrence, RPS, retries, priorités, fichier d'état)
- `sfpipe/resilience.py` : `RateLimiter` token bucket async (+ `min_interval`, `penalize()` global sur 429/flood), `with_retries` (backoff exponentiel full-jitter, respect `Retry-After`), `RetryableError` / `FatalError`
- `sfpipe/media.py` : scan récursif, parsing noms (`Titre (Année)`, `Série S01E02`, qualité 2160p/4K/1080p/720p/480p), fallback `ffprobe` hauteur, manifest CSV/JSON, `quick_hash` (taille + 3×4 Mio → `qh1:…`), `ProgressFile` (streaming + compteur d'octets, Content-Length auto aiohttp)
- `sfpipe/providers/pixeldrain.py` : `PUT /api/file/{name}` Basic `:key`, vérif `/file/{id}/info` (taille) → `external_id`=id, `raw_url`=`/u/{id}`
- `sfpipe/providers/onefichier.py` : `POST /v1/upload/get_upload_server.cgi` (Bearer) → multipart `file[]` sur `upload.cgi?id=` (+ `did` dossier) → `end.pl?xid=` header `JSON: 1` (poll) → `external_id` extrait de `https://1fichier.com/?id`, `raw_url`=lien ; anti-flood (403/429 → pause globale 60 s), API espacée de 2,5 s
- `sfpipe/catalog.py` (supabase async, service_role) : résolution titre par slug (+ `slug-année`), création optionnelle titre/saison/épisode non publiés (`--create-missing`, verrou), dédup `(provider, checksum)`, insert `media_sources` (qualité, container, taille, checksum, priorité ; 23505 → récupère l'existant)
- `sfpipe/state.py` : `.state/uploads.json` atomique → reprise (upload fait mais insert raté ⇒ insert seul), skip si déjà en base
- `scripts/upload_pipeline.py` : CLI argparse — files `asyncio.Queue` par provider, N workers/provider (Pixeldrain 3, 1fichier 2), un fichier peut partir en parallèle sur les 2 providers, log de progression (%/débit), `--dry-run`, `--no-db`, `--manifest`, `--report rapport.json`, Ctrl+C propre (reprise), code retour 2 si échecs
- `tests/` : 16 tests unitaires (parsing, hash, ProgressFile, retries, Retry-After, rate limiter) ✅
- Note : `pixeldrain_pro.py` absent du workspace → architecture batch async réimplémentée (queue + workers + rate limiter partagé)

### Non vérifié
- Appels réels Pixeldrain / 1fichier / Supabase non testés (PyPI inaccessible dans le sandbox → `aiohttp`/`supabase` non installables ici)

### Usage
```
cd pipelines && ./setup.sh            # Windows : .\setup.ps1
.venv/bin/python scripts/upload_pipeline.py ../media/inbox --dry-run
.venv/bin/python scripts/upload_pipeline.py ../media/inbox --create-missing --report report.json
```

### Prochaine action — Étape 7 : Intégration AList / Rclone
- `infra/docker-compose.yml` : AList + Redis (+ rclone serve) ; config AList (stockages Pixeldrain/1fichier/local), token admin en secret
- `rclone.conf` modèle : remotes `pixeldrain:`, `1fichier:` (backend natif), `alist:` (WebDAV), cache VFS ; script `pipelines/scripts/rclone_sync.py` (sync inbox → remotes, `--checksum`, bwlimit)
- Provider `alist` dans `resolve-stream` : URL signée AList (`/d/<path>?sign=`) en fallback ; enregistrement des chemins AList dans `media_sources` (provider `alist`)

## Étape 7 — Panel admin catalogue (2026-10-28) ✅ ADMIN FINALISÉ
> L'étape AList/Rclone prévue est reportée (voir « Backlog »).

### Terminé
- **Migration `0003_admin.sql`** : trigger `set_published_at` (date auto à la 1ʳᵉ publication) ; RPC `admin_save_title(p_title jsonb, p_genre_ids smallint[], p_sources jsonb)` — security invoker + contrôle `is_admin()`, création/màj atomique du titre, remplacement des genres, synchro des sources du film (update par id, insert sans id, delete des absentes ; `p_sources = null` → inchangées) — testé PG16 (création, édition, suppression en cascade, non-admin refusé)
- `database.ts` : fonction `admin_save_title`
- Deps : `@radix-ui/react-alert-dialog`, `@radix-ui/react-switch`
- Shadcn (manuels) : `table`, `textarea`, `badge`, `native-select`, `switch`, `alert-dialog`
- `lib/utils.ts` : `slugify` ; `lib/admin.ts` : `getIsAdmin` (lecture `profiles.role`, cache par user, purgé sur `onAuthStateChange`), schéma zod `titleFormSchema` (+ sources), `normalizeExternalId` (URL Pixeldrain/1fichier → ID), `fetchAdminList` (recherche `ilike`, filtres type/statut, pagination 20, `media_sources(count)`, `.range()` en dernier), `fetchTitleForEdit`, `fetchGenres`, `createGenre`, `saveTitle` (RPC), `deleteTitle`, `setPublished`, `adminErrorMessage` (FR)
- Garde : `_authed.beforeLoad` expose `isAdmin` ; `_authed/_shell/admin.tsx` redirige vers `/` si non admin (RLS = 2ᵉ barrière côté BDD) ; lien « Admin » dans `AppHeader`
- Routes : `/admin` (table : affiche, titre/slug, type, année, catégories, nb sources, switch publication, éditer/supprimer + filtres/recherche/pagination en search params), `/admin/new`, `/admin/$id` (formulaire + suppression)
- `components/admin/TitleForm.tsx` : infos (type verrouillé en édition, slug auto), catégories (chips + création), sources vidéo (film : hébergeur/ID/URL/qualité/priorité/active, multi-sources ; série → info pipeline), visuels avec aperçu, publication ; `DeleteTitleButton` (AlertDialog)
- Vérif syntaxique OK

### Non vérifié
- Typecheck/rendu (npm bloqué dans le sandbox) ; appliquer `0003` (`supabase db push`)

### Prochaine action — Étape 8 : Moteur de recherche
- RPC `search_titles(q, type?, genre?, limit, offset)` : `websearch_to_tsquery('simple', unaccent(q))` sur `titles.search` + fallback trigram `similarity(title, q)` (pg_trgm déjà installé), tri par rang, publiés uniquement ; extension `unaccent` + index
- Route `/search?q=` (debounce 300 ms, synchronisée à l'URL), champ de recherche dépliable dans `AppHeader` (raccourci `/`), grille de `MovieCard`, état vide, skeletons
- Cache Redis optionnel des requêtes fréquentes côté Edge Function (phase 2)

### Backlog
- Intégration AList / Rclone (docker-compose AList + Redis, `rclone.conf`, `rclone_sync.py`, provider `alist` signé dans `resolve-stream`)
- Gestion admin des saisons/épisodes et de leurs sources

## Étape 8 — Moteur de recherche (2026-10-28) ✅ RECHERCHE FINALISÉE
### Terminé
- **Migration `0004_search.sql`** : extension `unaccent`, wrapper immutable `f_unaccent()`, colonne générée `titles.search` recréée sans accents (titre A / titre original B / synopsis C) + index GIN, index trigram `lower(f_unaccent(title))` ; RPC `search_titles(p_q, p_type, p_genre, p_limit, p_offset)` (security invoker → publiés uniquement via RLS) : `websearch_to_tsquery` + `ilike` titre/synopsis + `similarity`/`word_similarity` (fautes de frappe), rang = ts_rank_cd×2 + similarité + bonus exact/préfixe, `genres` jsonb, `total_count` — testé PG16 (accents, faute « polaaris », synopsis, filtres type+genre, pagination, vide, brouillons exclus)
- `database.ts` : fonction `search_titles`
- `lib/search.ts` : `validateSearchParams` (q ≤ 100, type, genre slug, page ≤ 20), `searchTitles` (RPC + genres en cache mémoire ; fallback données mockées si catalogue publié vide), constantes page 30 / debounce 300 ms
- `components/layout/HeaderSearch.tsx` (dans `AppHeader`, toutes les pages du shell) : loupe dépliable, debounce 300 ms → `/search?q=` (replace sur /search pour ne pas polluer l'historique, conserve les filtres), synchro URL→champ, raccourci `/`, Échap (efface/replie), bouton effacer ; header compacté (email ≥ xl, libellé déconnexion ≥ lg)
- `routes/_authed/_shell/search.tsx` → `/search?q=&type=&genre=&page=` : filtres type en onglets (Tout/Films/Séries) + chips catégories (scroll horizontal mobile), grille CSS responsive 2→6 colonnes de `MovieCard`, « Afficher plus » (page+1, sans reset scroll), skeleton (`pendingComponent`, `pendingMs` 150), spinner + opacité pendant rechargement, état « Aucun résultat » (conseils, retirer les filtres, tout le catalogue), mode « Explorer » si q vide
- Vérif syntaxique OK

### Non vérifié
- Typecheck/rendu (npm bloqué dans le sandbox) ; appliquer `0004` (`supabase db push`)
- Les résultats pointent vers `/title/$slug`, encore un stub (page de détail à faire)

### Prochaine action — Étape 9 : « Ma Liste » / Favoris
- Migration `0005_my_list.sql` : table `my_list (user_id, title_id, added_at, PK(user_id,title_id))`, RLS propriétaire (select/insert/delete), index `(user_id, added_at desc)`
- `lib/my-list.ts` : `fetchMyList`, `addToList`, `removeFromList`, hook `useMyList` (Set d'IDs, mise à jour optimiste + rollback)
- Bouton `+` / `✓` sur `MovieCard` (overlay hover), `HeroBanner` et page détail ; route `/my-list` (grille, état vide) ; lien « Ma liste » dans le header ; rangée « Ma liste » sur l'accueil

### Backlog
- Page de détail `/title/$slug` (saisons/épisodes, CTA lecture) — actuellement stub
- Intégration AList / Rclone
- Gestion admin des saisons/épisodes et de leurs sources

## Étape 9 — « Ma Liste » / Favoris (2026-10-28) ✅ MA LISTE FINALISÉE
### Terminé
- **Migration `0005_user_favorites.sql`** : table `user_favorites (user_id default auth.uid(), title_id → titles, created_at, PK(user_id,title_id))` (`title_id` = films **et** séries), index `(user_id, created_at desc)` + `(title_id)` ; RLS propriétaire select/insert/delete, insert limité aux titres publiés ; grants colonne (`insert(title_id)` → impossible d'usurper `user_id`) — testé PG16 (doublon, brouillon, usurpation, isolation entre users, anon refusé)
- `database.ts` : table `user_favorites`
- Dep `sonner` + `components/ui/sonner.tsx` (Shadcn, thème sombre) ; `<Toaster>` dans `__root`
- `lib/favorites.ts` : store global `useSyncExternalStore` (IDs favoris chargés une fois par user, partagés par toutes les cartes), `toggleFavorite` optimiste + rollback, toasts (« Ajouté » + action **Voir** → `/my-list` ; « Retiré » + action **Annuler**), titres mockés gérés en local ; hooks `useFavorites` / `useFavorite` ; `fetchMyList` (join `titles` + genres, tri ajout récent) ; `resetFavorites()` sur `SIGNED_OUT`
- `components/catalog/FavoriteButton.tsx` : variante `icon` (+ / ✓ rond, overlay carte) et `button` (« Ma liste » / « Dans ma liste »)
- `MovieCard` restructuré : conteneur `div` (hover/scale/focus-within) + `Link` + `FavoriteButton` frère (plus de bouton imbriqué dans `<a>`), visible au survol / si favori / toujours sur mobile ; prop `favorite` (désactivé sur « Reprendre la lecture »)
- `HeroBanner` : bouton Ma liste
- **Page détail `/title/$slug` réelle** (`lib/title.ts` `fetchTitleDetail`) : backdrop, logo/titre, métadonnées, synopsis, genres → `/search?genre=`, CTA Lecture/Reprendre (+ barre de progression), Ma liste ; séries : sélecteur de saison + liste d'épisodes (vignette, durée, résumé, progression) → `/watch/$id?episode=` ; fallback mock
- Route `/my-list` : grille `MovieCard`, compteur, disparition immédiate au retrait (annulable), état vide, skeleton ; lien « Ma liste » dans `AppHeader`
- Vérif syntaxique OK

### Non vérifié
- Typecheck/rendu (npm bloqué dans le sandbox) ; appliquer `0005` (`supabase db push`)

### Prochaine action — Étape 10 : Page de profil utilisateur
- Route `/profile` : avatar (upload Supabase Storage bucket `avatars`, RLS dossier = `auth.uid()`), `display_name`, `username` (unicité, validation zod), email (lecture seule) — update via grants colonnes existants sur `profiles`
- Sécurité : changement de mot de passe (`auth.updateUser`), changement d'email (confirmation), déconnexion de tous les appareils (`signOut({ scope: 'global' })`)
- Historique : liste `watch_progress` (reprendre / retirer de l'historique), stats (titres vus, temps total)
- Préférences : langue audio/sous-titres par défaut, autoplay épisode suivant (colonne `preferences jsonb` sur `profiles` + grant update)
- Menu avatar dans `AppHeader` (Profil, Ma liste, Admin, Déconnexion)

### Backlog
- Intégration AList / Rclone
- Gestion admin des saisons/épisodes et de leurs sources
- Rangée « Ma liste » sur l'accueil

## Étape 10 — Page de profil (2026-10-28) ✅ PROFIL FINALISÉ
### Terminé
- Dep `@radix-ui/react-avatar` + `components/ui/avatar.tsx` (Shadcn)
- `lib/profile.ts` : `getMyProfile` (cache par user, pas de cache sur erreur) **remplace `getIsAdmin`/`clearAdminCache`** (retirés de `lib/admin.ts`) ; `_authed.beforeLoad` expose `profile` + `isAdmin` (dérivé de `profile.role`) ; `clearProfileCache` sur `onAuthStateChange` ; schéma zod `profileSchema` (display_name ≤ 60, username `^[a-zA-Z0-9_]{3,30}$` = contrainte BDD, avatar https) ; `updateMyProfile` (update colonnes autorisées par les grants, erreurs FR : 23505 pseudo pris, 23514, PGRST116) ; `initials()` ; hook `useSignOut(scope)` → `auth.signOut({ scope })` → purge cache → `navigate('/login', replace)`
- Route `/profile` (`_authed/_shell/profile.tsx`, protégée par la garde `_authed` → `/login?redirect=/profile`) : carte identité (avatar avec aperçu live, nom, @username, badge admin, membre depuis), carte session (déconnexion / déconnexion de tous les appareils `scope: 'global'`), formulaire Shadcn Form (email lecture seule, nom affiché, nom d'utilisateur, URL avatar ; Annuler/Enregistrer actifs si modifié ; toast succès ; `router.invalidate()` → header à jour)
- `AppHeader` : avatar (image ou initiales) → `/profile` ; déconnexion via `useSignOut` (redirection propre vers `/login`)
- Vérif syntaxique OK

### Non vérifié
- Typecheck/rendu (npm bloqué dans le sandbox) — **à faire en priorité avant déploiement**

### Prochaine action — Étape 11 : Préparation au déploiement
- Validation locale complète : `npm install`, `npm run typecheck`, `npm run build`, corriger les erreurs de types ; ESLint + Prettier (config + scripts) ; tests e2e Playwright minimum (login → accueil → recherche → lecture → ma liste)
- Supabase prod : `supabase link`, `db push` (0001→0005), secrets Edge (`ALLDEBRID_API_KEY`, `PIXELDRAIN_API_KEY`, `UPSTASH_*`, `ALLOWED_ORIGIN` = domaine prod), `functions deploy resolve-stream`, Auth → Site URL + Redirect URLs prod, SMTP custom, advisors sécurité/perf
- Frontend : `vercel.json` / `netlify.toml` / `Dockerfile` nginx (fallback SPA `index.html`, cache immutable `/assets/*`, en-têtes sécurité CSP/HSTS/Referrer-Policy) ; variables `VITE_*` prod ; retrait devtools en prod (déjà conditionné à `DEV`)
- CI GitHub Actions : install → typecheck → build → tests (+ pytest pipeline) ; déploiement auto sur `main`
- Retirer/flagger les données mockées en prod (`VITE_ENABLE_MOCKS`)

### Backlog
- Upload d'avatar (Supabase Storage bucket `avatars`), changement mot de passe/email, historique de visionnage, préférences lecture
- Intégration AList / Rclone
- Gestion admin des saisons/épisodes et de leurs sources
- Rangée « Ma liste » sur l'accueil

## Étape 11 — Débridage Alldebrid & streaming (2026-10-28) ✅ DÉBRIDAGE FINALISÉ
> Le pipeline de résolution existait (étape 5) ; cette étape le durcit et ajoute états/erreurs UI. « Préparation au déploiement » reportée à l'étape 12.

### Terminé
- **`supabase/functions/_shared/alldebrid.ts`** (serveur uniquement) : `unlock(link)` → `GET /v4/link/unlock` (clé en `Authorization: Bearer`, jamais dans l'URL ni côté client, `agent`), timeout 12 s, gestion `delayed` (`/v4/link/delayed`), 2 tentatives sur erreurs transitoires ; classification des codes Alldebrid → `offline` (LINK_DOWN…), `unsupported`, `protected`, `host_busy`, `auth` (AUTH_*, MUST_BE_PREMIUM), `server_blocked` (NO_SERVER), `unavailable` (réseau/5xx/MAINTENANCE) ; `isDebridHost(url)` (1fichier + domaines miroirs, uptobox, rapidgator, turbobit, nitroflare, mega, mediafire…, match strict du hostname) ; messages FR — **15 tests unitaires OK** (fetch mocké : succès, delayed, LINK_DOWN, NO_SERVER, AUTH, réseau+retry, détection d'hôtes, domaine piège)
- **`_shared/providers.ts`** réécrit : identification de l'origine côté serveur — Pixeldrain → URL directe (timeout 8 s, 404 = offline) ; `onefichier` **ou toute `raw_url` d'un hébergeur supporté** → débridage Alldebrid ; sinon URL directe (AList) ; `ResolveError.kind`
- **`resolve-stream`** : réponse `debrid: boolean` (+ cache) ; en échec, code agrégé `source_offline` (404) / `debrid_unavailable` / `host_busy` / `all_sources_failed` + `reasons[]`
- **Nouvelle Edge Function `debrid-link`** (admin uniquement via `is_admin()`) : `POST { link }` → lien direct + filename/filesize/host ; refuse URLs invalides / hôtes non supportés
- **Front** :
  - `lib/stream.ts` : codes `source_offline`, `debrid_unavailable`, `host_busy`, titres `STREAM_ERROR_TITLES`, `RETRYABLE_STREAM_ERRORS`, `StreamInfo.debrid` ; `loadWatch` ne résout plus le flux (métadonnées seules)
  - `hooks/useStream.ts` : machine d'état `resolving(attempt) → ready | error`, anti-réponses tardives
  - `components/player/StreamStatus.tsx` : overlay plein écran sur backdrop flouté — Alert Shadcn « Chargement » (étapes : source → débridage Alldebrid → flux) / Alert destructive par code (icône dédiée, Réessayer si récupérable, Accueil / Se reconnecter)
  - `routes/_authed/watch.$id.tsx` : `WatchSession` remonté par épisode (`key`), URL directe injectée en `src` du `VideoPlayer`, erreur média → re-débridage sans cache → bascule de source (`exclude`) → nouvel essai, changement de qualité, reprise à la dernière position
  - Admin : `components/admin/DebridTester.tsx` (« Tester le débridage Alldebrid » par source 1fichier/hébergeur supporté) + `lib/admin.ts` `debridLinkFor`/`testDebridLink`
- Choix sécurité : le navigateur n'envoie **jamais** de lien brut à débrider (sinon proxy de débridage ouvert sur le compte) ; il envoie `titleId/episodeId`, le serveur lit `media_sources` (service_role) et débride

### Risques / à vérifier
- **Alldebrid bloque souvent les IP datacenter (`NO_SERVER`)** → depuis Supabase Edge, le débridage peut être refusé. Si c'est le cas en prod : exécuter le resolver sur un hôte autorisé (service Node `services/resolver` sur machine perso/VPS whitelisté) appelé par l'Edge Function, ou contacter Alldebrid. L'UI affiche « Débridage indisponible »
- Les liens débridés peuvent être liés à l'IP du demandeur ; tester la lecture depuis le navigateur quand le débridage est fait côté serveur
- Typecheck/rendu toujours non exécutés (npm bloqué) ; déployer : `supabase functions deploy resolve-stream debrid-link`

### Prochaine action — Étape 12 : Préparation au déploiement
- Validation locale : `npm install`, `npm run typecheck`, `npm run build` (corriger les types) ; ESLint/Prettier ; e2e Playwright (login → accueil → recherche → lecture → ma liste) ; `deno test` des Edge Functions
- **Test réel Alldebrid depuis l'Edge Function** (vérifier `NO_SERVER`) → décider : Edge direct vs resolver auto-hébergé
- Supabase prod (db push 0001→0005, secrets, deploy functions, Auth URLs, SMTP, advisors) ; hébergement front (fallback SPA, cache assets, CSP/HSTS) ; CI GitHub Actions ; flag `VITE_ENABLE_MOCKS`

## Étape 12 — Abonnements, gestion utilisateurs & sécurité (2026-10-28) ✅ MODULE ADMIN/ABONNEMENTS FINALISÉ
> « Préparation au déploiement » décalée en étape 13.

### Terminé — BDD (`0006_subscriptions_security.sql`, testée PG16 + stubs `vault`/`authenticator`)
- **Abonnements** : `subscriptions` (1 ligne/user : `status` active|suspended|canceled, `ends_at`), journal `subscription_events` (source code/admin_adjust/admin_set/admin_status, delta, avant/après, acteur, note) ; `has_active_subscription()` (admins toujours true) ; `_apply_subscription_days` interne (cumul depuis max(now, fin actuelle))
- **Codes d'activation** : `activation_codes` — 25 caractères, alphabet 32 symboles sans 0/O/1/I (`gen_random_bytes`, sans biais), **seule l'empreinte sha256 est stockée** + `code_hint` ; statuts active|used|revoked ; expiration optionnelle ; `admin_generate_codes(count≤500, days, label, expires_at)` renvoie les codes en clair **une seule fois** ; `admin_set_code_status` ; `redeem_activation_code(code)` (normalisation, verrou `for update`, codes used/expired/revoked, refus si suspendu, **anti brute-force 10 échecs/h** via `redeem_attempts`, retour JSON pour journaliser les échecs)
- **Admin users** : `admin_list_users(q, filter active|expired|suspended|admin, limit, offset)` (join `auth.users` côté serveur), `admin_adjust_subscription(user, ±jours, note)`, `admin_set_subscription(user, ends_at|null, status, note)`
- **Bannissement IP** : `ip_bans (ip cidr unique — IP seule ou plage, reason, expires_at null=permanent)` + index GiST `inet_ops` ; `ip_ban_lookup(ip)` ; `request_ip()` (cf-connecting-ip → x-real-ip → 1er x-forwarded-for) ; **middleware PostgREST `check_request()`** branché via `alter role authenticator set pgrst.db_pre_request` → toute requête REST/RPC d'une IP bannie = HTTP 403 `ip_banned` (motif en detail, expiration en hint)
- **Clés API** : `app_secrets (name whitelist, vault_secret_id, last4)` + **Supabase Vault** ; `admin_set_api_key` (valide le nom avant toute écriture), `admin_delete_api_key`, `admin_list_api_keys` (jamais la valeur), `get_api_key` **service_role uniquement**
- RLS/grants : écritures abonnements/codes uniquement via fonctions definer ; lecture own+admin ; `redeem_attempts`/`app_secrets` sans policy ; `ip_bans` admin

### Terminé — Edge Functions
- `_shared/admin-client.ts` (service_role singleton), `_shared/secrets.ts` (`getSecret` : Vault via `get_api_key`, cache 5 min, fallback env) → utilisé par `alldebrid.ts`, `providers.ts` (Pixeldrain), `redis.ts`
- `_shared/guard.ts` : `clientIp`, `lookupBan`, `denyIfBanned` (403), `denyIfNoSubscription` (402)
- `resolve-stream` : IP bannie → 403, **abonnement requis → 402 `subscription_required`** ; `debrid-link` : IP ; nouvelle fonction **`ip-check`** (statut IP du visiteur)

### Terminé — Front
- Deps : `@radix-ui/react-dialog` + `components/ui/dialog.tsx`
- **Middleware TanStack** : `__root.beforeLoad` → session + `getIpStatus` (ip-check, cache 60 s, fail-open) → redirect `/banned` ; `lib/supabase.ts` `guardedFetch` : toute réponse 403 `ip_banned` (PostgREST/Edge) → `/banned` ; route `routes/banned.tsx` (motif, expiration, re-vérifier)
- `lib/subscription.ts` (cache, `isSubscriptionActive`, `daysLeft`, `formatCode`/`normalizeCode`, `redeemCode` + messages FR) ; `_authed` expose `subscription` + `hasAccess` ; bandeau « Activer un code » dans `_shell` si pas d'accès ; `StreamStatus` gère `subscription_required` (→ `/profile#subscription`) et `ip_banned`
- **Profil** : `components/profile/SubscriptionCard.tsx` (statut, date de fin, jours restants, saisie masquée XXXXX-…, compteur 25, toast, erreurs Alert)
- **Admin** (`lib/admin-ops.ts`, onglets Catalogue / Utilisateurs / Abonnements / Sécurité) :
  - `/admin/users` : recherche, filtres, pagination, badges ; `ManageSubscriptionDialog` (activation rapide 7 j→1 an, ±N jours/années, date de fin fixe, suspendre/réactiver, note, historique)
  - `/admin/billing` : génération par lot (quantité, durée + presets, libellé, expiration), affichage unique + copier + CSV, liste filtrable (désactiver/réactiver)
  - `/admin/security` : liste noire IP/CIDR (durées 1 h→permanent, motif, protection anti auto-ban, débloquer), gestionnaire de clés API (écriture seule, ••••last4, afficher/masquer, supprimer → fallback env)
- Vérif syntaxique OK

### Risques / à vérifier en prod
- **Ordre des en-têtes IP** : vérifier quels en-têtes Supabase transmet réellement (`request.headers` / Edge) et que `x-forwarded-for` n'est pas usurpable dans la chaîne ; ajuster `request_ip()` + `clientIp()` ensemble
- `alter role authenticator set pgrst.db_pre_request` : autorisé sur Supabase (documenté) — vérifier après `db push` (`notify pgrst, 'reload config'`) ; GoTrue (/auth) n'est **pas** couvert par le pre-request
- Vault doit être activé sur le projet ; secrets mis à jour pris en compte ≤ 5 min par les Edge Functions
- Typecheck/build toujours non exécutés (npm bloqué)

### Prochaine action — Étape 13 : Préparation au déploiement
- Validation locale : `npm install`, `npm run typecheck`, `npm run build` (corriger les types — 12 étapes non compilées) ; ESLint/Prettier ; e2e Playwright (inscription → code d'activation → lecture → ma liste → admin) ; `deno test` Edge Functions ; `pytest` pipeline
- Supabase prod : `db push` 0001→0006, Vault, deploy `resolve-stream`, `debrid-link`, `ip-check`, test réel Alldebrid (`NO_SERVER`) + en-têtes IP, Auth URLs/SMTP, advisors
- Hébergement front (fallback SPA, cache assets, CSP/HSTS), CI GitHub Actions, flag `VITE_ENABLE_MOCKS`

## Étape 13 — Sous-titres & pistes audio (2026-10-28) ✅ SOUS-TITRES FINALISÉS
> « Préparation au déploiement » décalée en étape 14.

### Terminé
- **Migration `0007_subtitles.sql`** (testée PG16 + stub `storage`) : table `subtitles` (title_id **XOR** episode_id, `language` BCP 47, `label`, `url` http(s), `format` vtt|srt, `storage_path`, `is_default` — 1 max par vidéo, `is_forced`), unicité (vidéo, langue, libellé), trigger film-only au niveau titre ; RLS lecture si titre publié (ou admin), écriture admin ; **bucket Storage `subtitles`** (public en lecture, 2 Mo, écriture/suppression admin via policies `storage.objects`)
- **Edge Function `subtitle`** : `POST {id}` → lecture RLS du sous-titre → fetch borné (8 s, 2 Mo, hôtes privés refusés) → décodage UTF-8 / repli Windows-1252 → **conversion SRT→WebVTT** (`_shared/subtitles.ts`, testée) → `text/vtt` + CORS ; IP bannie refusée
- **`resolve-stream` audio** : paramètre `audio` (BCP 47) → priorité aux sources dont `audio_languages` contient la langue ; réponse `audios` (toutes langues dispo) + `audio` (langues de la source servie)
- Front :
  - Dep `@radix-ui/react-dropdown-menu` + `components/ui/dropdown-menu.tsx` (Shadcn, prop `container` pour portail dans le conteneur plein écran)
  - `lib/subtitles.ts` : `fetchSubtitles`, `loadSubtitleUrl` (Edge → Blob URL même origine, cache ; **aucun `crossorigin` requis sur `<video>`**), `languageName` (Intl.DisplayNames fr), préférence langue `localStorage`, `pickInitialTrack` (préférence > défaut > forcés dans la langue audio), admin : `listSubtitlesAdmin`, `uploadSubtitle` (Storage + rollback si insert échoue), `addSubtitleLink`, `setDefaultSubtitle`, `deleteSubtitle` (+ objet Storage)
  - `loadWatch` renvoie `subtitles` ; `StreamInfo.audios/audio`
  - `components/player/PlayerMenus.tsx` : `SubtitlesMenu` (Désactivés / pistes, forcés, indisponible, spinner), `AudioMenu` (pistes natives `audioTracks` si > 1 — Safari — sinon sources alternatives par langue), `QualityMenu` (remplace l'ancien menu maison) — DropdownMenu Shadcn, contrôles maintenus visibles menu ouvert
  - `VideoPlayer` : `<track kind="subtitles">` chargés à la demande, bascule `mode` showing/disabled, raccourci **C**, mémorisation de la langue, styles `video::cue` (index.css) ; props `subtitles`, `loadSubtitle`, `audios`, `audio`, `onAudioChange`
  - Watch : changement de langue audio → re-résolution (`audio` conservé lors d'un changement de qualité), reprise à la position
  - **Admin** `/admin/$id` : `components/admin/SubtitlesManager.tsx` — film : liste du titre ; série : sélecteur d'épisode — tableau (langue, libellé, format, source, défaut/forcés, étoile défaut, suppression) + ajout par **upload** ou **lien URL** (langue avec suggestions, libellé auto, défaut, forcés)
- Vérif syntaxique OK

### Limites connues
- Pistes audio intégrées d'un même fichier : sélection uniquement si le navigateur expose `audioTracks` (Safari) ; ailleurs → une source par langue (`media_sources.audio_languages`, renseigné par le pipeline/admin)
- Typecheck/build toujours non exécutés (npm bloqué)

### Prochaine action — Étape 14 : Préparation au déploiement
- Validation locale complète : `npm install`, `npm run typecheck`, `npm run build` (13 étapes non compilées) ; ESLint/Prettier ; e2e Playwright ; `deno test` ; `pytest`
- Supabase prod : `db push` 0001→0007, Vault, Storage, deploy `resolve-stream`, `debrid-link`, `ip-check`, `subtitle` ; tests réels Alldebrid (`NO_SERVER`) + en-têtes IP
- Hébergement front (fallback SPA, cache, CSP/HSTS), CI GitHub Actions, flag `VITE_ENABLE_MOCKS`
- Admin : champ `audio_languages` dans le formulaire des sources (aujourd'hui seulement via pipeline)

## Étape 14 — Cache Redis du catalogue (2026-10-28) ✅ CACHE REDIS FINALISÉ
> « Préparation au déploiement » décalée en étape 15.

### Terminé
- **`_shared/redis.ts` réécrit — 2 drivers auto** : `REDIS_URL` (redis:// / rediss://) → **ioredis** (`npm:ioredis@5.4.1`, connexion réutilisée par instance chaude, timeouts courts, pas de file hors-ligne) ; sinon **Upstash REST** ; sinon no-op. Toute erreur/timeout (800 ms) = cache miss → l'app ne dépend jamais de Redis. API : `get/set/del/getRaw/incr/enabled`
- **`_shared/catalog-cache.ts`** : clés **versionnées** `catalog:v{N}:home` / `catalog:v{N}:search:{sha1(params)}`, `remember()` read-through (Redis → Supabase → SET EX **3600 s**), `invalidateCatalog()` = `INCR catalog:version` (purge O(1), anciennes clés expirent seules) — **4 tests unitaires OK**
- **Edge Function `catalog`** (verify_jwt) : `op: home` (60 titres publiés + genres) / `op: search` (q normalisée, type, genre, page ≤ 20 → RPC `search_titles` + genres) / `op: invalidate` (admin via `is_admin`) ; lectures en service_role **avec filtre `is_published` explicite** (aucun brouillon en cache, même si un admin déclenche le miss) ; utilisateurs connectés uniquement (rôle JWT), IP bannie refusée ; en-tête `X-Cache: HIT|MISS` (exposé CORS)
- **Edge Function `catalog-webhook`** (`verify_jwt = false`, `supabase/config.toml`) : authentifiée par `x-webhook-secret` (Vault, ≥ 16 car., comparaison temps constant) → `invalidateCatalog()`
- **Migration `0008_catalog_cache.sql`** (testée PG16 + stub `net`) : `pg_net` ; triggers **statement-level** sur `titles`, `title_genres`, `genres` → `notify_catalog_change()` → `net.http_post` asynchrone (no-op si non configuré, n'échoue jamais l'écriture) ; nouvelles clés du coffre `REDIS_URL`, `CATALOG_WEBHOOK_URL`, `CATALOG_WEBHOOK_SECRET` (contrainte + `admin_set_api_key` mis à jour) — couvre admin, pipeline Python, SQL direct
- **Front** :
  - `lib/catalog-api.ts` : `invokeCatalog` (Edge `catalog`, état de cache loggé en DEV, `null` si indisponible) + `invalidateCatalogCache`
  - `fetchHome` : catalogue via Redis → **repli direct Supabase** ; « Reprendre la lecture » toujours en direct (données par utilisateur, non cachées)
  - `searchTitles` : Redis → repli RPC direct ; genres inclus dans la réponse cachée
  - Admin : purge explicite après `saveTitle`, `deleteTitle`, `setPublished`, `createGenre` (en plus du webhook) ; `/admin/security` : carte « Cache Redis du catalogue » (purge manuelle) + 3 nouvelles clés (bouton « Générer » pour le secret)
- Vérif syntaxique OK

### Mise en service
1. `supabase db push` (0008, active `pg_net`) ; `supabase functions deploy catalog catalog-webhook` (config.toml : `catalog-webhook` sans JWT)
2. `/admin/security` : `REDIS_URL` **ou** `UPSTASH_REDIS_REST_URL`+`TOKEN` ; `CATALOG_WEBHOOK_URL` = `https://<ref>.supabase.co/functions/v1/catalog-webhook` ; `CATALOG_WEBHOOK_SECRET` (Générer)
3. Vérifier `X-Cache: MISS` puis `HIT` (onglet Réseau) ; modifier un titre → MISS

### Limites
- ioredis (TCP) en Edge : fonctionne si le runtime autorise le TCP sortant vers l'hôte Redis ; sinon utiliser Upstash REST (recommandé en serverless)
- Page détail, Ma liste, progression : non cachés (données par utilisateur ou faible trafic)

### Prochaine action — Étape 15 : Préparation au déploiement
- Validation locale complète : `npm install`, `npm run typecheck`, `npm run build` (14 étapes non compilées) ; ESLint/Prettier ; e2e Playwright ; `deno test` ; `pytest`
- Supabase prod : `db push` 0001→0008, Vault, Storage, pg_net, deploy `resolve-stream`, `debrid-link`, `ip-check`, `subtitle`, `catalog`, `catalog-webhook` ; tests réels Alldebrid (`NO_SERVER`), en-têtes IP, Redis HIT/MISS
- Hébergement front (fallback SPA, cache, CSP/HSTS), CI GitHub Actions, flag `VITE_ENABLE_MOCKS` ; admin : `audio_languages` dans le formulaire des sources

## Étape 15 — Statistiques admin (2026-10-28) ✅ STATISTIQUES FINALISÉES
> « Préparation au déploiement » décalée en étape 16.

### Terminé
- **Migration `0009_stats.sql`** (testée PG16) :
  - Table **`watch_daily`** (user × titre × jour, secondes) — `watch_progress` ne stockant qu'une position, le temps réel est agrégé ici ; RLS sans accès client ; **backfill** de l'historique (position atteinte, durée si terminé)
  - **`save_progress` v2** (security definer, contrôle explicite titre publié) : ajoute à `watch_daily` le delta de position **plafonné au temps réellement écoulé depuis la dernière sauvegarde (+5 s)** → seeks et appels forgés ne gonflent pas les stats
  - RPC admin (`is_admin()`) : `admin_stats_overview(p_days)` → JSON KPI (temps total / période / période précédente, spectateurs actifs 7 j + 7 j précédents, connexions 7 j, inscrits, abonnements actifs, titres publiés, contenus terminés) + **série journalière** (secondes, spectateurs, jours vides inclus) ; `admin_stats_top_titles(p_days|null, limit)` (spectateurs uniques, temps cumulé, complétions) ; `admin_stats_user_watch_time(p_days|null, limit, p_user)` (temps global par utilisateur ou d'un utilisateur)
- Dep **`recharts` ^2.15.3** ; `database.ts` : 3 fonctions
- `lib/stats.ts` : `fetchStats` (3 RPC en parallèle), `formatDuration`, `delta`, formats FR
- `components/admin/StatsCharts.tsx` : `KpiCard` (valeur + variation ↑/↓ vs période précédente), `WatchTimeChart` (aire, heures/jour), `ViewersChart` (barres, spectateurs/jour) — **deux graphiques séparés, jamais de double axe**, série unique en `--primary` (validée dataviz sur surface sombre), grille récessive, tooltip, « Voir les données » (tableau accessible) ; `TopTitlesTable` (rang, affiche, type, spectateurs, jauge Tailwind du temps cumulé, terminés, lien édition) ; `TopUsersTable`
- Route **`/admin/stats?period=7|30|90`** (défaut 30) : filtre de période en tête, 4 KPI, 2 graphiques, top 10 contenus, top utilisateurs ; onglet « Statistiques » dans le layout admin
- Vérif syntaxique OK

### Non vérifié
- Rendu des graphiques non inspecté visuellement (npm et CDN bloqués dans le sandbox) ; typecheck/build toujours non exécutés

### Prochaine action — Étape 16 : Préparation au déploiement
- Validation locale complète : `npm install`, `npm run typecheck`, `npm run build` (15 étapes non compilées), inspection visuelle (accueil, lecteur, admin/stats) ; ESLint/Prettier ; e2e Playwright ; `deno test` ; `pytest`
- Supabase prod : `db push` 0001→0009, Vault, Storage, pg_net, deploy des 7 Edge Functions (`resolve-stream`, `debrid-link`, `ip-check`, `subtitle`, `catalog`, `catalog-webhook`, + config.toml) ; tests réels Alldebrid (`NO_SERVER`), en-têtes IP, Redis HIT/MISS
- Hébergement front (fallback SPA, cache, CSP/HSTS), CI GitHub Actions, flag `VITE_ENABLE_MOCKS` ; admin : `audio_languages` dans le formulaire des sources

## Étape 16 — Notifications temps réel (2026-10-28) ✅ NOTIFICATIONS FINALISÉES
> « Préparation au déploiement » décalée en étape 17.

### Terminé
- **Migration `0010_notifications.sql`** (testée PG16 + stub publication) :
  - Enum `notification_type` (info, new_content, subscription, warning, system) ; table **`notifications`** (id, `user_id` null = globale, type, message ≤ 500, `link` chemin interne uniquement, `read_status`, created_by, created_at) + index
  - **`notification_reads`** : état « lu » **par utilisateur** pour les alertes globales (un `read_status` unique ne peut pas servir à tous) — testé : bob lit une globale, eve la voit toujours non lue
  - RLS : lecture des siennes + globales (+ admin) — **appliquée aussi par Realtime** ; update limité à `read_status` sur ses notifications ; insert/delete admin
  - RPC : `my_notifications(limit)` (fusion read_status / notification_reads ; globales depuis 30 j avant l'inscription), `mark_notification_read(id)`, `mark_all_notifications_read()`, `admin_send_notification(message, type, link, user|null)`
  - **Notifications automatiques** : publication d'un titre → globale « Nouveau film/Nouvelle série : … » (lien `/title/slug`) ; `subscription_events` → personnelle (code activé, jours ajoutés/retirés, suspension…)
  - **Realtime** : `alter publication supabase_realtime add table public.notifications`
- Deps `@radix-ui/react-popover`, `@radix-ui/react-scroll-area` + `components/ui/popover.tsx`, `scroll-area.tsx` ; `database.ts` (table, 4 RPC, enum)
- **`hooks/useNotifications.ts`** : historique au montage, canal **`supabase.channel('custom-insert-channel')`** `postgres_changes` INSERT `public.notifications` → ajout instantané (dédoublonné, filtre perso d'autrui) + toast (action « Voir » si lien), rechargement à la reconnexion et au retour sur l'onglet, `markRead` / `markAllRead` optimistes avec rollback, `unreadCount`, état `live`
- **`components/layout/NotificationBell.tsx`** (dans `AppHeader`) : cloche + badge non lus (9+, animation à l'arrivée), Popover + ScrollArea : en-tête (pastille temps réel, « Tout lire »), liste (icône par type, message, temps relatif FR, « tous les utilisateurs », point non lu), clic = lu + navigation, skeleton / vide / erreur
- **Admin** `/admin/users` : `BroadcastNotificationCard` (message 500 car., type, lien interne optionnel validé, envoi à tous, 5 dernières alertes globales + suppression)
- Vérif syntaxique OK

### Mise en service
- `supabase db push` (0010) ; vérifier dans Dashboard → Database → Publications que `notifications` est dans `supabase_realtime`
- Typecheck/build toujours non exécutés (npm bloqué)

### Prochaine action — Étape 17 : Préparation au déploiement
- Validation locale complète : `npm install`, `npm run typecheck`, `npm run build` (16 étapes non compilées), inspection visuelle ; ESLint/Prettier ; e2e Playwright (dont réception temps réel) ; `deno test` ; `pytest`
- Supabase prod : `db push` 0001→0010, Vault, Storage, pg_net, Realtime, deploy des Edge Functions (+ config.toml) ; tests réels Alldebrid (`NO_SERVER`), en-têtes IP, Redis HIT/MISS
- Hébergement front (fallback SPA, cache, CSP/HSTS — autoriser `wss://<ref>.supabase.co`), CI GitHub Actions, flag `VITE_ENABLE_MOCKS`
- Backlog : notifications ciblées depuis la fiche utilisateur admin, purge auto des notifications > 90 j (pg_cron)

## Étape 17 — Historique & « Reprendre la lecture » (2026-10-28) ✅ HISTORIQUE FINALISÉ
> « Préparation au déploiement » décalée en étape 18.

### Terminé
- **`watch_progress` existante (0001) conservée** — correspondance spec : `movie_id` → `title_id` (films **et** séries, + `episode_id`), `progress_seconds` → `position_seconds`, `total_duration` → `duration_seconds`, `updated_at` (trigger) ; RLS propriétaire déjà en place (select/insert/update/delete own) — renommer aurait cassé lecteur, stats, RPC
- **Migration `0011_history.sql`** (testée PG16) : RPC security invoker `my_watch_history(limit, offset)` (1 ligne par titre = dernier épisode/visionnage, saison/épisode, ratio, tri `updated_at` desc, `total_count`) et `my_continue_watching(limit)` (**2 % ≤ progression ≤ 95 %**, durée connue) ; isolation entre utilisateurs, suppression d'un élément / vidage vérifiés
- `database.ts` : 2 RPC + `CompositeTypes.history_row`
- `lib/history.ts` : `fetchHistory` (pagination 60), `fetchContinueWatching`, `removeFromHistory` (tous les épisodes d'un titre), `clearHistory`, `toCatalogTitle`, `episodeLabel` (S1:É2 · Nom), `resumeAt` (0 si > 95 %), `watchedAgo`
- **Accueil** : carrousel « Reprendre la lecture » **juste sous le Hero** (avant Tendances), alimenté par `my_continue_watching` (une entrée par série, libellé d'épisode)
- **`MovieCard`** : barre rouge fine (`--primary`, `position/duration × 100`, `role=progressbar`) + prop `caption` (épisode)
- **Reprise** : cartes Historique / Reprendre → `/watch/$id?episode=…&t=<position>` → `VideoPlayer` démarre à `t` ; `loadWatch` reprend aussi par défaut si ≤ 95 % (avant : `completed` à 92 %)
- **Route `/history`** : grille de cartes backdrop (progression, épisode, « il y a … », position / durée ou « Terminé »), bouton ✕ par élément (optimiste + rollback), « Vider l'historique » (AlertDialog de confirmation), « Afficher plus », état vide, skeleton ; liens « Historique » dans `AppHeader` et le profil
- Vérif syntaxique OK

### Note
- Vider l'historique efface les positions (`watch_progress`) mais pas les agrégats statistiques (`watch_daily`)

### Prochaine action — Étape 18 : Préparation au déploiement
- Validation locale complète : `npm install`, `npm run typecheck`, `npm run build` (17 étapes non compilées), inspection visuelle ; ESLint/Prettier ; e2e Playwright (lecture → reprise depuis historique) ; `deno test` ; `pytest`
- Supabase prod : `db push` 0001→0011, Vault, Storage, pg_net, Realtime, deploy des Edge Functions (+ config.toml) ; tests réels Alldebrid (`NO_SERVER`), en-têtes IP, Redis HIT/MISS
- Hébergement front (fallback SPA, cache, CSP/HSTS + `wss://`), CI GitHub Actions, flag `VITE_ENABLE_MOCKS`

## Étape 18 — Profils multiples & contrôle parental (2026-10-28) ✅ MULTI-PROFILS FINALISÉS
> « Préparation au déploiement » décalée en étape 19.

### Terminé — BDD (`0012_viewer_profiles.sql`, testée PG16 ; **reconstruction complète 0001→0012 OK**)
- `public.profiles` (profil du **compte**) existait → nouvelle table **`viewer_profiles`** (id, user_id, name, avatar_url `preset:*`|https, is_kids_profile, **pin_code = hash bcrypt**, position) ; `pin_code` **jamais lisible** (grants colonne) ; max 5 / compte ; nom unique par compte ; profil par défaut créé pour chaque compte existant + trigger à l'inscription
- **`watch_progress` & `user_favorites` : + `profile_id`** (backfill vers le profil par défaut, NOT NULL) avec **FK composite `(profile_id, user_id)` → `viewer_profiles(id, user_id)`** : un profil d'un autre compte est inutilisable (RLS `user_id = auth.uid()` conservée) ; unicités `(profile_id, title_id, episode_id)` et PK `(profile_id, title_id)`
- RPC (JSON `{ok, error}`, échecs journalisés) : `my_viewer_profiles` (has_pin), `unlock_viewer_profile`, `create_viewer_profile`, `update_viewer_profile` (PIN : null = inchangé, '' = supprimer), `delete_viewer_profile` (pas le dernier ; cascade progression/favoris) ; **anti brute-force 5 échecs / 15 min** (`viewer_pin_attempts`)
- **Contrôle parental** : dès qu'un profil adulte a un PIN → créer un profil adulte, retirer « Enfants », changer un PIN ou supprimer exige un PIN parental ; un profil protégé exige son PIN (ou parental) pour toute modification
- **Catalogue enfants** : `genres.is_family` (animation, famille, jeunesse…), `is_kids_safe(maturity, title)` = « Tous publics »/« 10+ » ou (sans classification + genre familial) ; `catalog_titles(p_kids, limit)` ; `search_titles(..., p_kids)` (signature recréée) ; `can_profile_watch(profile, title)` → ok | kids_restricted | profile_not_found
- `save_progress(p_profile_id, …)`, `my_watch_history(p_profile_id, …)`, `my_continue_watching(p_profile_id, …)` (signatures recréées)

### Terminé — Edge
- `catalog` : `kids` sur home/search (clés Redis distinctes `home-kids`, params de recherche), genres familiaux pour l'accueil enfants, `catalog_titles` côté serveur
- `resolve-stream` : **`profileId` obligatoire**, `can_profile_watch` → 403 `profile_required` / `kids_restricted`

### Terminé — Front
- Dep `input-otp` + `components/ui/input-otp.tsx` (Shadcn, caret animé)
- `lib/viewer-profiles.ts` : liste (cache), **profil actif par compte (localStorage) + store** (`useSyncExternalStore`), mutations + messages FR, presets d'avatar ; effacé à la connexion (login/register) et à la déconnexion → « Qui est-ce ? » obligatoire
- **React Context `ActiveProfileProvider` / `useActiveProfile()`** (profiles, activeProfile, isKids, selectProfile, switchProfile, refreshProfiles) monté dans `_authed` ; `_authed.beforeLoad` expose `viewerProfiles`, `activeProfile`, `isKids` ; `requireActiveProfile()` dans `_shell` et `watch` → redirection `/profiles?redirect=`
- **Route `/profiles`** (plein écran) : grille d'avatars centrée, sélection, **« Gérer les profils »** (crayon), ajout (≤ 5), `ProfileFormDialog` (nom, 8 avatars dégradés ou URL, Enfants, PIN définir/changer/supprimer via InputOTP, suppression), **`PinDialog`** (InputOTP 4 chiffres masqués, validation auto) pour déverrouiller et pour les opérations protégées (retente automatique avec PIN)
- `ProfileAvatar` (initiale sur dégradé / image, badges Enfants & cadenas) ; `ProfileMenu` (header) : profils rapides, gérer, compte, admin, déconnexion ; badge « Enfants » dans le logo
- **Requêtes refondues avec l'ID du profil** : favoris (store par profil, insert/delete/fetch `profile_id`), progression (`save_progress`), historique / reprise, `loadWatch` (reprise, dernier épisode), détail titre (progression + restriction enfants), `resolveStream` ; accueil & recherche filtrés enfants (+ mocks)
- Profil Enfants : pas d'accès `/admin` ni `/profile` (compte), page détail « non disponible » pour un contenu non familial, lecteur → `kids_restricted`
- Vérif syntaxique OK

### Limites
- Le PIN protège l'interface et les opérations sensibles côté serveur ; l'accès aux données d'un profil verrouillé n'est pas lié à une « session de profil » serveur (même compte = même JWT)
- Admin : pas encore d'interface pour marquer un genre « familial » (`genres.is_family`, à faire en SQL ou backlog)

### Prochaine action — Étape 19 : Préparation au déploiement
- Validation locale complète : `npm install`, `npm run typecheck`, `npm run build` (18 étapes non compilées), inspection visuelle ; ESLint/Prettier ; e2e Playwright (login → Qui est-ce → PIN → lecture → reprise par profil) ; `deno test` ; `pytest`
- Supabase prod : `db push` 0001→0012, Vault, Storage, pg_net, Realtime, deploy des Edge Functions ; tests réels Alldebrid, IP, Redis
- Hébergement front (fallback SPA, cache, CSP/HSTS + `wss://`), CI, flag `VITE_ENABLE_MOCKS`

## Étape 19 — Préparation production serverless (2026-10-28) ✅ PRÊT POUR LA PRODUCTION SERVERLESS (sous réserve du 1er build)
### Terminé
- **`vercel.json` (racine, monorepo)** : install/build ciblant `apps/web`, sortie `apps/web/dist`, **rewrite SPA `/(.*)` → `/index.html`** (fichiers statiques servis en priorité), cache `immutable` sur `/assets/*`, `no-cache` sur `index.html`, en-têtes sécurité (HSTS, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP) + **CSP** (`connect-src` https/wss `*.supabase.co`, `media-src https: blob:` pour les flux débridés, `script-src 'self'`) ; `.vercelignore`
- **Build** (`apps/web/package.json`) : `build = typecheck && vite build`, `typecheck = tsr generate && tsc -p …app/node --noEmit` (génère `routeTree.gen.ts` **avant** tsc — corrige l'échec sur clone vierge), `build:fast`, `preview`, `engines.node >= 20.19`, `.nvmrc` 22 ; dev dep `@tanstack/router-cli` + `tsr.config.json` (partagé avec le plugin Vite) ; `vite.config.ts` : target es2022, chunks vendors (react, router, supabase, charts) ; `routeTree.gen.ts` ignoré par git
- `requireActiveProfile` déplacé dans `lib/route-guards.ts` (un fichier de route ne doit exporter que `Route` avec le code-splitting)
- **Mocks** : `env.enableMocks` = DEV ou `VITE_ENABLE_MOCKS=true` ; en prod catalogue vide → état « catalogue vide » (accueil, recherche, détail) ; validation https de `VITE_SUPABASE_URL` en prod
- **Alldebrid** : déjà côté serveur (`_shared/alldebrid.ts` via `resolve-stream` / `debrid-link`) — pas de fonction `alldebrid-proxy` ajoutée : un proxy recevant des liens bruts serait un débrideur ouvert sur le compte
- **Variables** : `apps/web/.env.production.example` (Vercel : `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_ENABLE_MOCKS`), `supabase/functions/.env.example` (secrets serveur + Vault) ; **`DEPLOY.md`** (tableaux des variables, réglages Supabase, commandes, vérifications)
- `supabase/config.toml` : les 6 Edge Functions (`verify_jwt` explicite ; `catalog-webhook` sans JWT)
- **`scripts/deploy.sh`** : link + `db push` + secrets + deploy des 6 fonctions + build + `vercel pull/build --prod/deploy --prebuilt --prod`
- **CI `.github/workflows/ci.yml`** : web (install + build avec env factices), `deno check` des Edge Functions, tests Python

### NON vérifié (bloquant avant mise en ligne)
- **Aucun `npm install` / `npm run build` / `vercel build` n'a pu être exécuté** (registre npm et CLI Vercel inaccessibles dans le sandbox) : 19 étapes de front jamais compilées → s'attendre à des erreurs de types à corriger au 1er build (CI ou local)
- Edge Functions jamais exécutées sous Deno (`deno check` en CI)

### Prochaine action — Étape 20 : Premier build & corrections
1. Lier le dossier du projet à la session (ou pousser sur GitHub → CI) : `npm install`, `npm run build` → corriger toutes les erreurs TS/ESLint
2. `deno check supabase/functions/*/index.ts` → corriger
3. Déploiement staging (projet Supabase de test + preview Vercel), parcours e2e complet, test réel Alldebrid (`NO_SERVER`), en-têtes IP, Realtime, Redis
4. Puis `./scripts/deploy.sh` en production

## Étape 20 — Contrôle de version (2026-10-28) ✅ SOUS GIT, PRÊT À LIER À GITHUB/VERCEL
### Terminé
- **`.gitignore` durci** : `.env`, `.env.*`, `*.env`, `.env.local` (seuls `*.example` suivis), `supabase/functions/.env`, `pipelines/.env`, clés (`*.pem`, `*.key`, `*.p12`, `secrets/`, `*secret*.json`, `service-account*.json`, `rclone.conf`), `node_modules`, `dist`, `.vite`, `*.tsbuildinfo`, `routeTree.gen.ts`, `.vercel`, `supabase/.temp`, `.venv`, `.state`, rapports pipeline, médias (`*.mp4`, `*.mkv`…) — correction : `.env.production.example` était ignoré par l'ancienne règle
- **Scan de secrets** avant commit : aucun JWT, clé `sk_*`, valeur de clé API ou `.env` réel dans les fichiers suivis (seuls les 4 `.env*.example` vides)
- `git init -b main` + commit initial `feat: initial commit platform` (163 fichiers, auteur Hedy)
- GitHub CLI non authentifié dans le sandbox → **`setup_github.sh`** : `./setup_github.sh <url-du-depot>` (remote add/set-url origin, `branch -M main`, `push -u origin main`, garde-fou anti-`.env` suivi) ; sans argument et avec `gh` connecté : `gh repo create streamflex --private --source=. --push`

### Prochaine action — Étape 21 : GitHub → Vercel → premier build
1. Créer un dépôt **privé** vide sur GitHub → `./setup_github.sh https://github.com/<user>/streamflex.git`
2. La CI GitHub Actions lance `npm install` + `npm run build` + `deno check` + tests Python → récupérer les erreurs du **premier build** (jamais compilé) et les corriger
3. Vercel : Import Git Repository, variables `VITE_*` (Production + Preview) → déploiement continu sur `main`, previews sur PR
4. Supabase : `./scripts/deploy.sh` (staging d'abord), Auth URLs = domaine Vercel
