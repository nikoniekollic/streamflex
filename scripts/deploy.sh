#!/usr/bin/env bash
# Déploiement production serverless : Supabase (BDD + Edge Functions) puis Vercel (front).
# Prérequis : supabase CLI ≥ 2 connecté (`supabase login`), Vercel CLI (`npx vercel login`), projet lié.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${SUPABASE_PROJECT_REF:?export SUPABASE_PROJECT_REF=<ref>}"

echo "▶ Supabase : liaison + migrations 0001→0012"
supabase link --project-ref "$SUPABASE_PROJECT_REF"
supabase db push

echo "▶ Supabase : secrets Edge Functions"
if [ -f supabase/functions/.env ]; then
  supabase secrets set --env-file supabase/functions/.env --project-ref "$SUPABASE_PROJECT_REF"
else
  echo "  (supabase/functions/.env absent — secrets inchangés)"
fi

echo "▶ Supabase : Edge Functions"
for fn in resolve-stream debrid-link subtitle ip-check catalog catalog-webhook source-maintenance; do
  supabase functions deploy "$fn" --project-ref "$SUPABASE_PROJECT_REF"
done

echo "▶ Front : build de vérification puis déploiement Vercel"
npm install --prefix apps/web --no-audit --no-fund
npm run build --prefix apps/web
npx --yes vercel@latest pull --yes --environment=production
npx --yes vercel@latest build --prod
npx --yes vercel@latest deploy --prebuilt --prod

echo "✓ Déployé. Vérifier : Auth → URL Configuration (Site URL + Redirect URLs = domaine Vercel), /admin/security (clés + webhook)."
