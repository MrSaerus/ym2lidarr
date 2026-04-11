#!/usr/bin/env bash
set -Eeuo pipefail

API_BASE="${NEXT_PUBLIC_API_BASE:-}"
LIDARR_BASE="${NEXT_PUBLIC_LIDARR_BASE:-}"

mkdir -p /var/www/html
cat > /var/www/html/config.js <<EOF
window.NEXT_PUBLIC_API_BASE='${API_BASE}';
window.NEXT_PUBLIC_LIDARR_BASE='${LIDARR_BASE}';
EOF

npx -w apps/api prisma migrate deploy --config /app/prisma.config.ts

node apps/api/dist/main.js & p1=$!
nginx -g "daemon off;" & p2=$!
python3 -m uvicorn main:app --host 0.0.0.0 --port 8080 & p3=$!

trap 'kill -TERM $p1 $p2 $p3 2>/dev/null || true' INT TERM
wait -n $p1 $p2 $p3
exit $?