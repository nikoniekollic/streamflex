#!/usr/bin/env bash
# Liaison du dépôt local à GitHub (dépôt PRIVÉ recommandé) puis premier push.
# Usage : ./setup_github.sh https://github.com/<utilisateur>/<depot>.git
#    ou : ./setup_github.sh git@github.com:<utilisateur>/<depot>.git
set -euo pipefail
cd "$(dirname "$0")"

REPO_URL="${1:-<URL_DE_TON_DEPOT_GITHUB>}"
if [[ "$REPO_URL" == "<URL_DE_TON_DEPOT_GITHUB>" ]]; then
  # Option automatique si GitHub CLI est installé et connecté : crée le dépôt privé et pousse
  if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
    gh repo create streamflex --private --source=. --remote=origin --push
    exit 0
  fi
  echo "Usage : $0 <url-du-depot>   (crée d'abord un dépôt PRIVÉ vide sur https://github.com/new)" >&2
  exit 1
fi

# Garde-fou : aucun fichier de secrets suivi
if git ls-files | grep -E '(^|/)\.env($|\.)' | grep -vE '\.example$'; then
  echo "✗ Fichier .env suivi par git — retire-le (git rm --cached) avant de pousser." >&2
  exit 1
fi

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REPO_URL"
else
  git remote add origin "$REPO_URL"
fi
git branch -M main
git push -u origin main

echo "✓ Poussé sur $REPO_URL"
echo "→ Vercel : New Project → Import Git Repository → ce dépôt (vercel.json lu automatiquement)"
echo "→ Ajouter VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_ENABLE_MOCKS=false (Production + Preview)"
