#!/usr/bin/env bash
set -Eeuo pipefail
npx -w apps/api prisma migrate deploy --schema /app/prisma/schema.prisma
node apps/api/dist/main.js & p1=$!
node apps/web/server.js   & p2=$!
python3 -m uvicorn main:app --host 0.0.0.0 --port 8080 & p3=$!
trap 'kill -TERM $p1 $p2 $p3 2>/dev/null || true' INT TERM
wait -n $p1 $p2 $p3
exit $?
