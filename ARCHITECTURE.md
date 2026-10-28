# StreamFlex — Architecture

## Stack
| Couche | Techno |
|---|---|
| Frontend | React 19, Vite 6, TypeScript, TanStack Router (file-based, code-splitting auto), Tailwind CSS v4, Shadcn UI (new-york, neutral, dark) |
| Auth / DB | Supabase (Auth PKCE, PostgreSQL, RLS, Edge Functions) |
| Cache | Redis — ioredis (REDIS_URL) ou Upstash REST : catalogue accueil/recherche (TTL 1 h, clés versionnées), liens débridés |
| Stockage / streaming | AList (index + proxy HTTP des remotes) + Rclone (montages, sync, cache VFS) |
| Hébergeurs | Pixeldrain, 1fichier (stockage), Alldebrid (résolution/débridage des liens) |
| Automatisation | Python (ingestion, transcode, upload) + Node.js (workers, API de résolution) |

## Stratégie API hébergement
1. **Ingestion** (`pipelines/`, Python) : fichier source → (transcode/remux optionnel) → upload Pixeldrain (API REST, clé API) et/ou 1fichier (API upload) → enregistrement `media_sources` (provider, file_id, taille, checksum) dans Supabase.
2. **Résolution à la lecture** (Edge Function `resolve-stream`) : client → Edge Function/API authentifiée → lookup `media_sources` → 
   - Pixeldrain : URL directe `/api/file/{id}` (clé côté serveur, jamais exposée).
   - 1fichier : lien via Alldebrid (`/link/unlock`) ou API 1fichier premium.
   - Lien résultant mis en cache Redis (`stream:{media_id}:{quality}`, TTL < durée de validité du lien).
3. **Fallback multi-provider** : ordre de priorité par `media_sources.priority`, bascule automatique si 4xx/5xx ou quota.
4. **AList/Rclone** : remotes Pixeldrain/1fichier/local montés dans AList ; AList sert de proxy unifié (range requests) quand un lien direct n'est pas exploitable par le navigateur.
5. **Sécurité** : clés Pixeldrain/Alldebrid/1fichier uniquement côté serveur (secrets Edge Functions / env services) ; URLs signées courtes ; RLS sur toutes les tables.
6. **Contenu** : n'héberger/diffuser que des médias dont on détient les droits (contenu propre ou sous licence).

## Structure
```
streamflex/
├── apps/web/                 # Frontend React/Vite
│   ├── src/routes/           # Routes TanStack (file-based) → routeTree.gen.ts (généré)
│   │   ├── _guest/           # /login, /register (redirige si connecté)
│   │   └── _authed/          # garde auth → _shell/ (/, /browse, /search, /my-list, /history, /request, /profile, /title/$slug, /admin, /admin/new, /admin/$id, /admin/users, /admin/billing, /admin/security, /admin/stats, /admin/monitoring, /admin/requests) ; /profiles (Qui est-ce ?, hors shell) ; /banned (hors garde) + watch.$id (plein écran)
│   ├── src/components/ui/    # Composants Shadcn (carousel natif scroll-snap)
│   ├── src/components/catalog/ # MovieCard, HeroBanner, CategoryCarousel
│   ├── src/components/player/  # VideoPlayer
│   ├── src/components/admin/   # TitleForm, DeleteTitleButton
│   ├── src/hooks/            # useWatchProgress
│   ├── src/lib/              # supabase.ts, env.ts, utils.ts, auth.ts, catalog.ts, mock-catalog.ts
│   ├── src/types/database.ts # Types Supabase (Database)
│   └── components.json       # Config Shadcn CLI
├── services/                 # Node.js : resolver API, workers (à venir)
├── pipelines/                # Python : sfpipe/ (config, resilience, media, links, state, catalog, providers/) + scripts/upload_pipeline.py, scripts/mass_import.py + tests/
├── supabase/migrations/      # SQL versionné (0001 schéma, 0002 save_progress, 0003 admin_save_title, 0004 search_titles, 0005 user_favorites, 0006 subscriptions/codes/ip_bans/vault, 0007 subtitles + bucket, 0008 pg_net cache webhook, 0009 watch_daily + stats, 0010 notifications + realtime, 0011 historique RPC, 0012 viewer_profiles, 0013 media_sources compacte, 0014 monitoring last_streamed_at, 0015 content_requests, 0016 reviews + video_bookmarks)
├── supabase/functions/       # Edge Functions Deno : resolve-stream, debrid-link (admin), ip-check, subtitle, catalog, catalog-webhook, source-maintenance (+ _shared: background, subtitles, catalog-cache, alldebrid, providers, redis, cors, secrets, guard, admin-client)
├── vercel.json               # Déploiement front (SPA rewrite, en-têtes, CSP)
├── DEPLOY.md                 # Variables Vercel/Supabase + commandes
├── scripts/deploy.sh         # Déploiement complet
├── .github/workflows/ci.yml  # CI build + deno check + tests Python
├── ARCHITECTURE.md
├── MEMORY.md                 # Journal de bord (MAJ obligatoire à chaque étape)
└── .claudeignore
```

## Conventions
- Router context : `{ supabase }` injecté dans `createRouter`, accessible dans les `loader`.
- Ajout composants : `npx shadcn@latest add <composant>` depuis `apps/web`.
- Variables : `apps/web/.env.local` (voir `.env.example`), préfixe `VITE_` côté client uniquement pour clés publiques.

## Modèle de données (0001)
`profiles` 1–1 `auth.users` · `titles` (movie|series) → `seasons` → `episodes` · `media_sources` → film (`title_id`) **ou** épisode (`episode_id`) · `watch_progress` (user × title × episode?) · `genres` ↔ `title_genres`.
Accès : catalogue = connectés + publié ; profil/progression = propriétaire ; `media_sources` = admin/`service_role` uniquement, exposition client via RPC `get_available_qualities`.

## Auth
Session lue dans `__root.beforeLoad` → `context.session`. Gardes : layouts pathless `_guest` / `_authed`. `onAuthStateChange` → `router.invalidate()`. Formulaires : react-hook-form + zod + Shadcn Form.

## Lecture
`/watch/$id` → `loadWatch` → `functions.invoke('resolve-stream')` → URL directe → `<VideoPlayer>`. Progression : `useWatchProgress` → RPC `save_progress` (15 s + pause/fin/sortie). Erreur média → refresh (bypass cache) puis `exclude` de la source.

## Pipeline d'upload
Fichiers → `build_media` (parse nom, qualité, quick_hash) → queue par provider → workers async (rate limiter partagé + retries) → Pixeldrain `PUT /api/file` / 1fichier `get_upload_server → upload.cgi → end.pl` → `media_sources` (service_role). État local `.state/uploads.json` pour reprise/idempotence ; dédup en base par `(provider, checksum)`.

## Admin
`profiles.role = 'admin'` → `getMyProfile` (cache) → `profile` + `isAdmin` dans le contexte `_authed` → garde `/admin`. Écritures via RPC `admin_save_title` (atomique, `is_admin()` + RLS admin). Promotion : `update public.profiles set role='admin' where id='<uuid>';`

## Recherche
`HeaderSearch` (debounce 300 ms) → `/search?q&type&genre&page` → RPC `search_titles` (FTS `simple` + unaccent + pg_trgm, RLS publiés). Filtres = search params (partageables).

## Ma Liste
`user_favorites` (RLS propriétaire). Front : store global `lib/favorites.ts` (useSyncExternalStore) → `FavoriteButton` (cartes, hero, détail), optimiste + toasts Sonner. Page `/my-list`.

## Profil
`/profile` : lecture via `getMyProfile`, mise à jour `profiles` (grants colonnes : username, display_name, avatar_url). Déconnexion : `useSignOut(scope)` → `/login`.

## Débridage
Client → `resolve-stream` (titleId/episodeId) → `media_sources` (service_role) → `providers.resolveSource` : Pixeldrain direct | 1fichier & hébergeurs supportés → `alldebrid.unlock` (Bearer, delayed, retries, codes classés) | URL directe. Erreurs agrégées (`source_offline`, `debrid_unavailable`, `host_busy`) → `StreamStatus` (Alerts Shadcn). `debrid-link` = test admin d'un lien brut.

## Abonnements & sécurité
- Accès lecture = `has_active_subscription()` (admins exemptés) vérifié dans `resolve-stream` (402). Crédit via codes 25 car. (`redeem_activation_code`, hash sha256, anti brute-force) ou admin (`admin_adjust/set_subscription`), journalisé dans `subscription_events`.
- Bannissement IP en 3 couches : PostgREST `db_pre_request` → `check_request()` (toutes requêtes Data API), Edge `guard.denyIfBanned`, UI (`__root.beforeLoad` + `ip-check`, `guardedFetch` → `/banned`).
- Clés API externes : Supabase Vault via `/admin/security` → `get_api_key` (service_role) → `_shared/secrets.ts` (cache 5 min, fallback env).

## Sous-titres & audio
`subtitles` (film XOR épisode) → `loadWatch` → `VideoPlayer` (`SubtitlesMenu`) → Edge `subtitle` (SRT→VTT, CORS) → Blob URL → `<track>`. Audio : `audioTracks` natif ou sources alternatives (`media_sources.audio_languages`, `resolve-stream?audio=`).

## Cache catalogue
Front → Edge `catalog` (home/search) → Redis `catalog:v{N}:*` (TTL 1 h) → miss : Supabase (service_role + `is_published`). Invalidation : triggers `titles/title_genres/genres` → pg_net → `catalog-webhook` (secret) → `INCR catalog:version` ; + purge explicite depuis l'admin. Repli direct Supabase si Edge/Redis indisponible.

## Statistiques
`save_progress` (definer) → `watch_daily` (delta plafonné au temps écoulé) → RPC `admin_stats_overview` / `admin_stats_top_titles` / `admin_stats_user_watch_time` → `/admin/stats` (KPI, Recharts aire + barres, tableaux).

## Notifications
`notifications` (user_id null = globale) + `notification_reads` (lu par utilisateur pour les globales) ; publication `supabase_realtime`. Front : `useNotifications` (RPC `my_notifications` + canal `custom-insert-channel` INSERT) → `NotificationBell` (Popover/ScrollArea). Triggers : titre publié → globale ; `subscription_events` → personnelle. Admin : `admin_send_notification`.

## Historique & reprise
`watch_progress` → RPC `my_watch_history` / `my_continue_watching` (2–95 %) → `/history` et carrousel accueil → `/watch/$id?episode&t` → `VideoPlayer.startAt`.

## Profils de visionnage
Compte (`profiles`, rôle) ≠ profils de visionnage (`viewer_profiles`, ≤ 5, Enfants, PIN bcrypt). `watch_progress` / `user_favorites` portent `profile_id` (FK composite avec `user_id`). Front : `ActiveProfileProvider` (Context) + store localStorage ; `requireActiveProfile` → `/profiles`. Enfants : `is_kids_safe` (catalogue, recherche, cache Redis séparé, `resolve-stream`).

## Déploiement
Vercel (statique, `apps/web/dist`, rewrite SPA) + Supabase (Postgres/Auth/Storage/Realtime/Vault + 6 Edge Functions Deno). Aucun secret serveur dans le bundle : front = `VITE_SUPABASE_URL` + clé anon ; Alldebrid/Pixeldrain/Redis = secrets Edge ou Vault.

## Sources vidéo (stockage)
`media_sources` ne stocke que `(provider enum, file_id ≤ 32)` pour Pixeldrain/1fichier — aucune URL ; `buildStreamUrl` (Edge `_shared/stream-url.ts`) reconstruit l'URL à la résolution. ~183 o/ligne, 500 k lignes ≈ 173 Mo (index inclus), requête par titre < 1 ms.

## Import massif
`scripts/mass_import.py` : flux CSV/NDJSON → `parse_link` (provider, file_id) → résolution des cibles par lot → POST PostgREST par lots de 2000, `on_conflict=provider,file_id` + ignore-duplicates, workers parallèles à mémoire bornée, bissection des lots rejetés, `import_errors.log`.

## Monitoring des fichiers
Lecture → `resolve-stream` → `mark_source_streamed` (en arrière-plan, ≤ 1/h) → `last_streamed_at`. `/admin/monitoring` → `admin_cold_sources` (≥ 25 j / jamais lus) → Edge `source-maintenance` (info API officielle ou téléchargement partiel 1 Mio).

## Demandes de contenus
`/request` (RHF + Zod + Shadcn) → `content_requests` (RLS propriétaire, quotas, anti-doublon) → `/admin/requests` (regroupement des demandes similaires) → `admin_set_request_status` → notification personnelle (Realtime → cloche).

## Notes communautaires et marque-pages
- `reviews` (1 avis / profil / titre, note 1–5 + commentaire) → `/title/$slug` section « Avis et Notes » (`ReviewsSection` : moyenne + répartition via `title_rating_summary`, liste paginée `title_reviews`, `upsert_review`).
- `video_bookmarks` (timestamp + label, public/privé, épisode optionnel) → `VideoPlayer` : bouton « Marquer ce moment » (touche B, pause + Dialog portaillé dans le conteneur plein écran), panneau latéral (touche P), repères sur la barre de progression, clic = `currentTime = timestamp_seconds` + lecture. Données via `useBookmarks` → `title_bookmarks`.
- RLS : lecture pour tous les connectés (titres publiés ; marque-pages privés réservés à l'auteur), écriture/modification limitées au propriétaire (colonnes autorisées), suppression propriétaire ou admin (modération).
