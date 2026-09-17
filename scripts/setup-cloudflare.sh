#!/usr/bin/env bash
#
# Provisions the Cloudflare resources this app needs, and optionally deploys the
# Worker. Safe to re-run: every step checks for what already exists first, and
# nothing here deletes or overwrites data.
#
#   ./scripts/setup-cloudflare.sh              # provision only
#   ./scripts/setup-cloudflare.sh --deploy     # provision, then deploy the Worker
#   ./scripts/setup-cloudflare.sh --deploy -y  # ...without the confirmation prompt
#
# Requires: pnpm install already run, and `wrangler login` completed.
set -euo pipefail

D1_NAME="delisp"
R2_BUCKET="delisp-audio"
PAGES_PROJECT="delisp"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT/apps/api"
TOML="$API_DIR/wrangler.toml"
SEED_SQL="$ROOT/packages/schema/seed/exercises.sql"

DEPLOY=false
ASSUME_YES=false
for arg in "$@"; do
  case "$arg" in
    --deploy) DEPLOY=true ;;
    -y|--yes) ASSUME_YES=true ;;
    -h|--help) sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '\033[33m    %s\033[0m\n' "$*"; }
die()  { printf '\033[31mError: %s\033[0m\n' "$*" >&2; exit 1; }

wr() { (cd "$API_DIR" && pnpm exec wrangler "$@"); }

# ---------------------------------------------------------------- preflight

say "Checking prerequisites"
command -v pnpm >/dev/null || die "pnpm is not installed."
[ -d "$ROOT/node_modules" ] || die "Dependencies are not installed. Run: pnpm install"

if ! wr whoami 2>&1 | grep -qiE 'associated with the email|account id'; then
  die "wrangler is not authenticated. Run: cd apps/api && pnpm exec wrangler login"
fi
info "wrangler is authenticated."

# --------------------------------------------------------------------- D1

say "D1 database '$D1_NAME'"
d1_list="$(wr d1 list --json 2>/dev/null || echo '[]')"
d1_id="$(node -e '
  const name = process.argv[1];
  let rows = [];
  try { rows = JSON.parse(process.argv[2]); } catch {}
  const hit = (Array.isArray(rows) ? rows : []).find((r) => r.name === name);
  process.stdout.write(hit ? (hit.uuid ?? hit.database_id ?? "") : "");
' "$D1_NAME" "$d1_list")"

if [ -z "$d1_id" ]; then
  info "Not found — creating it."
  create_out="$(wr d1 create "$D1_NAME" 2>&1)" || { echo "$create_out"; die "Could not create the D1 database."; }
  d1_id="$(printf '%s' "$create_out" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)"
  [ -n "$d1_id" ] || { echo "$create_out"; die "Created the database but could not read its id from the output."; }
  info "Created: $d1_id"
else
  info "Already exists: $d1_id"
fi

# Write the id into wrangler.toml, replacing the placeholder or a previous id.
current_id="$(grep -E '^database_id' "$TOML" | head -1 | sed -E 's/.*"(.*)".*/\1/')"
if [ "$current_id" = "$d1_id" ]; then
  info "wrangler.toml already points at this database."
else
  node -e '
    const fs = require("fs");
    const [file, id] = process.argv.slice(1);
    const src = fs.readFileSync(file, "utf8");
    const next = src.replace(/^database_id = ".*"$/m, `database_id = "${id}"`);
    if (next === src) { console.error("Could not find database_id in wrangler.toml"); process.exit(1); }
    fs.writeFileSync(file, next);
  ' "$TOML" "$d1_id"
  info "Wrote the database id into apps/api/wrangler.toml — commit that change."
fi

# --------------------------------------------------------------------- R2

say "R2 bucket '$R2_BUCKET'"
if wr r2 bucket list 2>/dev/null | grep -q "$R2_BUCKET"; then
  info "Already exists."
else
  info "Not found — creating it."
  wr r2 bucket create "$R2_BUCKET" >/dev/null || die "Could not create the R2 bucket."
  info "Created."
fi

# ------------------------------------------------------------- migrations

say "Applying D1 migrations"
wr d1 migrations apply "$D1_NAME" --remote || die "Migrations failed."

# ------------------------------------------------------------------- seed

say "Seeding the exercise curriculum"
(cd "$ROOT" && pnpm content:seed >/dev/null)
info "Regenerated the seed SQL from content/exercises.yaml."
wr d1 execute "$D1_NAME" --file="$SEED_SQL" --remote --yes >/dev/null \
  || die "Seeding failed."
count="$(wr d1 execute "$D1_NAME" --command 'SELECT COUNT(*) AS n FROM exercises' --remote --json 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const r=JSON.parse(s);process.stdout.write(String(r[0]?.results?.[0]?.n ?? "?"))}catch{process.stdout.write("?")}})' || echo '?')"
info "Exercises in D1: $count"

# ------------------------------------------------------------ Pages project

say "Pages project '$PAGES_PROJECT'"
if wr pages project list 2>/dev/null | grep -q "$PAGES_PROJECT"; then
  info "Already exists."
else
  info "Not found — creating it."
  wr pages project create "$PAGES_PROJECT" --production-branch main >/dev/null \
    || warn "Could not create the Pages project. Create it in the dashboard, or CI deploy will fail."
fi

# ----------------------------------------------------------------- deploy

if [ "$DEPLOY" = true ]; then
  say "Deploying the Worker"
  if [ "$ASSUME_YES" != true ]; then
    printf '    This publishes apps/api to your Cloudflare account. Continue? [y/N] '
    read -r reply
    case "$reply" in [Yy]*) ;; *) info "Skipped."; DEPLOY=false ;; esac
  fi
  if [ "$DEPLOY" = true ]; then
    wr deploy || die "Deploy failed."
  fi
fi

# ------------------------------------------------------------- what is left

say "Done. What is left, and why it is not automated"

cat <<'NEXT'
    1. Cloudflare Access — the only thing protecting this data.
       Create a self-hosted Access application covering the app's hostname,
       with a policy allowing your email. Then put the team domain and the
       application's AUD tag into [vars] in apps/api/wrangler.toml and redeploy:

         ACCESS_TEAM_DOMAIN = "yourteam.cloudflareaccess.com"
         ACCESS_AUD         = "<the application's Application Audience tag>"

       While ACCESS_AUD is empty the Worker skips verification entirely. That is
       deliberate, so `wrangler dev` and the tests can run — but a deployed
       Worker with it empty is wide open. Do not leave it that way.

    2. Route the Worker on the same hostname as the Pages app.
       Uncomment and edit the `routes` line in apps/api/wrangler.toml. Same
       hostname means one Access policy covers both, and the browser never makes
       a cross-origin request.

    3. Two GitHub repository secrets, so CI can deploy the front end:
         CLOUDFLARE_API_TOKEN    (needs the "Cloudflare Pages: Edit" permission)
         CLOUDFLARE_ACCOUNT_ID
       Until both exist the deploy job skips itself rather than failing.

    4. Generate the model audio for shadowing, once:
         pnpm content:voices --base https://<your app hostname>

    None of these are automated because each one needs a decision only you can
    make: which hostname, which identity provider, which account.
NEXT
