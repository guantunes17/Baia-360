#!/bin/bash
# Daily Postgres backup for Baia 360 — pg_dump (data, all 3 schemas) +
# pg_dumpall --globals-only (roles/grants, NOT covered by pg_dump) uploaded
# together to DigitalOcean Spaces. See SDD section 10 / scripts/README_backup.md.
#
# Requires on host: s3cmd, docker (postgres container: baia360-postgres).
# Requires in env: DO_SPACES_KEY, DO_SPACES_SECRET, DO_SPACES_REGION,
# DO_SPACES_BUCKET. Never hardcode these.
set -euo pipefail

PG_CONTAINER="baia360-postgres"
PG_USER="baia360"
PG_DB="baia360"

RETAIN_DAILY=7
RETAIN_WEEKLY=4
RETAIN_MONTHLY=12

: "${DO_SPACES_KEY:?DO_SPACES_KEY not set}"
: "${DO_SPACES_SECRET:?DO_SPACES_SECRET not set}"
: "${DO_SPACES_REGION:?DO_SPACES_REGION not set}"
: "${DO_SPACES_BUCKET:?DO_SPACES_BUCKET not set}"

S3_HOST="${DO_SPACES_REGION}.digitaloceanspaces.com"
S3_HOST_BUCKET="%(bucket)s.${DO_SPACES_REGION}.digitaloceanspaces.com"

s3() {
    s3cmd --access_key="$DO_SPACES_KEY" --secret_key="$DO_SPACES_SECRET" \
          --host="$S3_HOST" --host-bucket="$S3_HOST_BUCKET" \
          --no-progress "$@"
}

TS="$(date -u +%Y%m%d_%H%M%S)"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

DUMP_FILE="$WORKDIR/baia360_${TS}.dump"
GLOBALS_FILE="$WORKDIR/baia360_${TS}.globals.sql"

echo "[backup] pg_dump -Fc (data, all schemas) -> $DUMP_FILE"
docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -Fc "$PG_DB" > "$DUMP_FILE"

echo "[backup] pg_dumpall --globals-only (roles/grants) -> $GLOBALS_FILE"
docker exec "$PG_CONTAINER" pg_dumpall -U "$PG_USER" --globals-only > "$GLOBALS_FILE"

if [ ! -s "$DUMP_FILE" ] || [ ! -s "$GLOBALS_FILE" ]; then
    echo "[backup] FAIL: one of the artifacts is empty" >&2
    exit 1
fi

# Which retention tiers this run belongs to. Daily always; weekly on Sunday;
# monthly on the 1st. A run can land in more than one tier on the same day.
TIERS=("daily")
[ "$(date -u +%u)" = "7" ] && TIERS+=("weekly")
[ "$(date -u +%d)" = "01" ] && TIERS+=("monthly")

for tier in "${TIERS[@]}"; do
    echo "[backup] uploading to backups/${tier}/"
    s3 put "$DUMP_FILE" "s3://${DO_SPACES_BUCKET}/backups/${tier}/$(basename "$DUMP_FILE")"
    s3 put "$GLOBALS_FILE" "s3://${DO_SPACES_BUCKET}/backups/${tier}/$(basename "$GLOBALS_FILE")"
done

# Prune a tier prefix down to the N most recent dump+globals pairs.
# Filenames embed a UTC timestamp (baia360_YYYYMMDD_HHMMSS...), so
# lexical sort == chronological sort.
prune_tier() {
    local tier="$1" keep="$2"
    local dumps
    dumps="$(s3 ls "s3://${DO_SPACES_BUCKET}/backups/${tier}/" \
             | awk '{print $4}' | grep '\.dump$' | sort)"
    local total
    total="$(echo "$dumps" | grep -c . || true)"
    [ "$total" -le "$keep" ] && return 0
    local to_delete=$((total - keep))
    echo "$dumps" | head -n "$to_delete" | while read -r dump_url; do
        [ -z "$dump_url" ] && continue
        local globals_url="${dump_url%.dump}.globals.sql"
        echo "[backup] pruning ${tier}: $(basename "$dump_url")"
        s3 del "$dump_url"
        # Known gap, not fixed here: a failed globals delete is swallowed,
        # which can orphan .globals.sql files over time (harmless, just
        # wasted storage — doesn't affect restore correctness).
        s3 del "$globals_url" || true
    done
}

prune_tier "daily" "$RETAIN_DAILY"
prune_tier "weekly" "$RETAIN_WEEKLY"
prune_tier "monthly" "$RETAIN_MONTHLY"

echo "[backup] done: ${TIERS[*]}"
