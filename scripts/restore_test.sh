#!/bin/bash
# Monthly restore test: "a backup never restored is not a backup" (SDD 10).
# Pulls the latest daily dump + globals from DO Spaces, restores BOTH into a
# throwaway Postgres container, and fails loud on either:
#   (a) a non-zero pg_restore exit code (a truncated dump can still restore
#       a few tables and silently fail on the rest — count() alone misses this)
#   (b) a row-count query erroring or the table not existing
# Requires on host: s3cmd, docker.
# Requires in env: DO_SPACES_KEY, DO_SPACES_SECRET, DO_SPACES_REGION,
# DO_SPACES_BUCKET.
set -euo pipefail

: "${DO_SPACES_KEY:?DO_SPACES_KEY not set}"
: "${DO_SPACES_SECRET:?DO_SPACES_SECRET not set}"
: "${DO_SPACES_REGION:?DO_SPACES_REGION not set}"
: "${DO_SPACES_BUCKET:?DO_SPACES_BUCKET not set}"

S3_HOST="${DO_SPACES_REGION}.digitaloceanspaces.com"
S3_HOST_BUCKET="%(bucket)s.${DO_SPACES_REGION}.digitaloceanspaces.com"
TEST_CONTAINER="baia360-postgres-restoretest"
TEST_PASSWORD="restoretest-throwaway"
TEST_DB="baia360_restoretest"

s3() {
    s3cmd --access_key="$DO_SPACES_KEY" --secret_key="$DO_SPACES_SECRET" \
          --host="$S3_HOST" --host-bucket="$S3_HOST_BUCKET" \
          --no-progress "$@"
}

WORKDIR="$(mktemp -d)"
cleanup() {
    docker rm -f "$TEST_CONTAINER" >/dev/null 2>&1 || true
    rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "[restore_test] finding latest daily dump"
LATEST_DUMP="$(s3 ls "s3://${DO_SPACES_BUCKET}/backups/daily/" \
                | awk '{print $4}' | grep '\.dump$' | sort | tail -n1)"
if [ -z "$LATEST_DUMP" ]; then
    echo "[restore_test] FAIL: no daily dump found in Spaces" >&2
    exit 1
fi
LATEST_GLOBALS="${LATEST_DUMP%.dump}.globals.sql"

echo "[restore_test] downloading $(basename "$LATEST_DUMP")"
s3 get "$LATEST_DUMP" "$WORKDIR/backup.dump"
s3 get "$LATEST_GLOBALS" "$WORKDIR/backup.globals.sql"

echo "[restore_test] starting throwaway container"
docker run -d --name "$TEST_CONTAINER" \
    -e POSTGRES_PASSWORD="$TEST_PASSWORD" \
    postgres:16-alpine >/dev/null

for i in $(seq 1 30); do
    docker exec "$TEST_CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
    sleep 1
    if [ "$i" = "30" ]; then
        echo "[restore_test] FAIL: throwaway container never became ready" >&2
        exit 1
    fi
done

docker cp "$WORKDIR/backup.globals.sql" "$TEST_CONTAINER:/tmp/backup.globals.sql"
docker cp "$WORKDIR/backup.dump" "$TEST_CONTAINER:/tmp/backup.dump"

echo "[restore_test] applying globals (roles/grants)"
# ON_ERROR_STOP=0 is intentional, not an oversight: globals.sql includes
# ALTER ROLE for roles the base postgres:16-alpine image already creates
# (e.g. "postgres" itself), which errors on a fresh container. Those errors
# are expected and harmless; a truncated/corrupt globals dump would still
# surface as missing roles in the pg_restore step below.
docker exec -u postgres "$TEST_CONTAINER" \
    psql -U postgres -v ON_ERROR_STOP=0 -f /tmp/backup.globals.sql >/dev/null

docker exec -u postgres "$TEST_CONTAINER" \
    psql -U postgres -c "CREATE DATABASE ${TEST_DB};" >/dev/null

# No CREATE SCHEMA step here on purpose: pg_dump -Fc (no -C/--create) still
# emits CREATE SCHEMA for identity/central/atlas as part of the normal
# object dump — -C only controls the top-level CREATE DATABASE wrapper, not
# schema-level DDL. Unverified against a real prod dump until the first
# manual run; if that assumption is wrong, pg_restore below will fail loud
# on missing-schema errors instead of silently, thanks to --exit-on-error.
echo "[restore_test] running pg_restore"
set +e
docker exec -u postgres "$TEST_CONTAINER" \
    pg_restore -U postgres -d "$TEST_DB" --exit-on-error /tmp/backup.dump
RESTORE_EXIT=$?
set -e
echo "[restore_test] pg_restore exit code: $RESTORE_EXIT"

PASS=1
[ "$RESTORE_EXIT" -ne 0 ] && PASS=0

check_table() {
    local schema_table="$1"
    local count
    if count="$(docker exec -u postgres "$TEST_CONTAINER" \
                psql -U postgres -d "$TEST_DB" -tAc "SELECT count(*) FROM ${schema_table};" 2>&1)"; then
        echo "[restore_test]   ${schema_table}: ${count} rows"
    else
        echo "[restore_test]   ${schema_table}: QUERY FAILED — $count" >&2
        PASS=0
    fi
}

echo "[restore_test] checking key tables"
check_table "identity.baia360_users"
check_table "central.relatorios_gerados"
check_table "atlas.atlas_conversas"

if [ "$PASS" = "1" ]; then
    echo "[restore_test] PASS"
    exit 0
else
    echo "[restore_test] FAIL (restore_exit=$RESTORE_EXIT)" >&2
    exit 1
fi
