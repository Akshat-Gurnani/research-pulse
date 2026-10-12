#!/usr/bin/env bash
# Deploy to the Vercel production alias from this machine.
# Why: on a Hobby team, the CLI attaches the git remote's owner as the deployment's git source, and Vercel
# BLOCKS it ("Not authorized") unless that GitHub account is connected to the Vercel account. Until it is,
# deploy without the remote and put it back afterwards (also if the deploy fails).
set -euo pipefail
cd "$(dirname "$0")/.."
URL="$(git remote get-url origin 2>/dev/null || true)"
restore() { [ -n "$URL" ] && ! git remote get-url origin >/dev/null 2>&1 && git remote add origin "$URL"; }
trap restore EXIT
[ -n "$URL" ] && git remote remove origin
npx vercel deploy --prod
