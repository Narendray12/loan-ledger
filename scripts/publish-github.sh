#!/usr/bin/env bash
# One-shot GitHub setup: creates the repo, pushes main, stores the VITE_* build secrets from .env,
# turns on GitHub Pages (workflow source) and prints the site URL.
#   gh auth login            # once, as the account that should own the repo
#   scripts/publish-github.sh [repo-name]
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="${1:-loan-ledger}"
OWNER="$(gh api user --jq .login)"
echo "Publishing as $OWNER/$REPO"

if ! gh repo view "$OWNER/$REPO" >/dev/null 2>&1; then
  gh repo create "$REPO" --public --source=. --remote=origin --description "Loan ledger for a money lender: offline-first PWA on Supabase" --push
else
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$OWNER/$REPO.git"
  git push -u origin main
fi

# Build-time settings for the Pages workflow (values are read from .env, never printed).
for key in VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY VITE_LENDER_NAME; do
  value="$(grep "^$key=" .env | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/')"
  [ -n "$value" ] && gh secret set "$key" --repo "$OWNER/$REPO" --body "$value"
done

# Pages served by the deploy workflow (idempotent).
gh api -X POST "repos/$OWNER/$REPO/pages" -f build_type=workflow >/dev/null 2>&1 \
  || gh api -X PUT "repos/$OWNER/$REPO/pages" -f build_type=workflow >/dev/null

gh workflow run deploy.yml --repo "$OWNER/$REPO" >/dev/null 2>&1 || true
echo "Site: https://$(echo "$OWNER" | tr '[:upper:]' '[:lower:]').github.io/$REPO/"
echo "Watch the deploy: gh run watch --repo $OWNER/$REPO"
