# Déploiement production — Vercel (front) + Supabase (BDD, Auth, Edge Functions)

## 1. Variables d'environnement

### Vercel — Project → Settings → Environment Variables (Production **et** Preview)
| Variable | Valeur | Exposée au navigateur |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` | oui |
| `VITE_SUPABASE_ANON_KEY` | clé `anon` / publishable (Supabase → Settings → API) | oui (clé publique, protégée par RLS) |
| `VITE_ENABLE_MOCKS` | `false` | oui |

> Aucune clé serveur (Alldebrid, Pixeldrain, Redis, service_role) ne doit être définie côté Vercel.

### Supabase — Edge Functions → Secrets (`supabase secrets set --env-file supabase/functions/.env`)
| Secret | Rôle | Aussi gérable dans `/admin/security` (Vault) |
|---|---|---|
| `ALLOWED_ORIGIN` | CORS : `https://<projet>.vercel.app` (ou `*`) | — |
| `ALLDEBRID_API_KEY` | débridage 1fichier & co | ✔ |
| `ALLDEBRID_AGENT` | nom d'agent Alldebrid (`streamflex`) | ✔ |
| `PIXELDRAIN_API_KEY` | vérification / lecture Pixeldrain | ✔ |
| `REDIS_URL` **ou** `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | cache catalogue / liens | ✔ |
| `CATALOG_WEBHOOK_SECRET` | auth du webhook d'invalidation | ✔ |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | injectés automatiquement | — |

Vault (`/admin/security`) est prioritaire sur les secrets d'environnement ; à saisir aussi : `CATALOG_WEBHOOK_URL = https://<ref>.supabase.co/functions/v1/catalog-webhook` (utilisé par pg_net).

### Pipeline Python (machine d'upload, hors Vercel) — `pipelines/.env`
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PIXELDRAIN_API_KEY`, `ONEFICHIER_API_KEY`.

## 2. Supabase (une fois)
1. Dashboard → Database → Extensions : `pg_net`, `pgcrypto`, `pg_trgm`, `unaccent` ; Vault activé.
2. Auth → URL Configuration : **Site URL** = domaine Vercel ; **Redirect URLs** = `https://<domaine>/login` (+ `http://localhost:5173/login`).
3. Auth → SMTP personnalisé (e-mails de confirmation en prod).

## 3. Commandes
```bash
export SUPABASE_PROJECT_REF=<ref>
./scripts/deploy.sh            # migrations + secrets + 6 Edge Functions + build + vercel --prod
```
Équivalent manuel :
```bash
supabase link --project-ref $SUPABASE_PROJECT_REF && supabase db push
supabase secrets set --env-file supabase/functions/.env
supabase functions deploy resolve-stream debrid-link subtitle ip-check catalog catalog-webhook
npm install --prefix apps/web && npm run build --prefix apps/web
npx vercel build --prod && npx vercel deploy --prebuilt --prod
```
Ou import Git sur vercel.com : la configuration est lue depuis `vercel.json` (racine).

## 4. Logique serveur Alldebrid
Déjà isolée côté serveur : `supabase/functions/_shared/alldebrid.ts` (clé en `Authorization: Bearer`), appelée par
`resolve-stream` (lecture : le client n'envoie que `profileId/titleId/episodeId`, jamais de lien brut) et `debrid-link` (test admin).
Aucune clé n'existe dans le bundle front.

## 5. Vérifications post-déploiement
- `/login` → « Qui est-ce ? » → lecture d'un titre : `resolve-stream` 200 (si `debrid_unavailable` : Alldebrid bloque l'IP datacenter, cf. MEMORY)
- Onglet Réseau : `catalog` → `X-Cache: MISS` puis `HIT`
- Rafraîchir une URL profonde (`/title/xxx`) → pas de 404 (rewrite SPA)
- Notification admin → reçue en temps réel (wss autorisé par la CSP)
