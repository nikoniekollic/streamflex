#!/usr/bin/env bash
# Push GitHub (déclenche Vercel) + déploiement Supabase production.
# Usage : ./scripts/push_and_deploy.sh <url-depot-github> <project-ref-supabase>
set -euo pipefail
cd "$(dirname "$0")/.."

REPO_URL="${1:?url du dépôt GitHub requise}"
PROJECT_REF="${2:?project-ref Supabase requis (Settings → General)}"

# Garde-fous
if git ls-files | grep -E '(^|/)\.env($|\.)' | grep -vE '\.example$'; then
  echo "✗ .env suivi par git" >&2; exit 1
fi
git check-ignore -q node_modules/ && git check-ignore -q dist/ && git check-ignore -q .env && git check-ignore -q .env.local \
  || { echo "✗ .gitignore incomplet" >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo "✗ modifications non commitées" >&2; exit 1; }

# 1. GitHub → Vercel
git remote get-url origin >/dev/null 2>&1 && git remote set-url origin "$REPO_URL" || git remote add origin "$REPO_URL"
git branch -M main
git push -u origin main

# 2. Supabase production
supabase link --project-ref "$PROJECT_REF"
supabase migration list
supabase db push --dry-run
read -rp "Appliquer ces migrations en PRODUCTION ? [o/N] " ok
[[ "$ok" == "o" ]] || { echo "Annulé (code poussé, base inchangée)."; exit 0; }
supabase db push

for fn in resolve-stream debrid-link subtitle ip-check catalog catalog-webhook source-maintenance; do
  supabase functions deploy "$fn" --project-ref "$PROJECT_REF"
done
echo "✓ GitHub poussé, migrations 0001→0016 appliquées, 7 Edge Functions déployées"
