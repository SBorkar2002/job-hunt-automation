#!/bin/bash
# Pushes apps-script/ to the Job hunt bot project, updates the existing web app
# (same URL), then reapplies the Sheet format and migrates old rows (setup action).
# Needs the one-time clasp login (see README).
set -euo pipefail
cd "$(dirname "$0")/.."
SHEET_URL=$(grep -E '^SHEET_URL=' .env | cut -d= -f2-)
SHEET_SECRET=$(grep -E '^SHEET_SECRET=' .env | cut -d= -f2-)
DEPLOYMENT=$(echo "$SHEET_URL" | sed -E 's#.*/s/([^/]+)/exec#\1#')
CLASP="$PWD/node_modules/.bin/clasp"
SCRIPT_ID=$(python3 -c 'import json;print(json.load(open(".clasp.json"))["scriptId"])')

if [ ! -f apps-script/appsscript.json ]; then
  # First time: fetch the project's manifest without touching our code.
  TMP=$(mktemp -d); (cd "$TMP" && $CLASP clone "$SCRIPT_ID" >/dev/null)
  cp "$TMP/appsscript.json" apps-script/appsscript.json; rm -rf "$TMP"
fi

$CLASP push --force
$CLASP deploy --deploymentId "$DEPLOYMENT" --description "update $(date '+%Y-%m-%d %H:%M')"
echo "Reapplying the Sheet format:"
node --input-type=module -e "import { call } from './shared/sheet.mjs'; const r = await call('setup'); console.log(r.ok ? 'Format applied and old rows fixed.' : r);"
