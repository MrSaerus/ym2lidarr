#!/usr/bin/env bash

touch /var/www/html/config.js

echo "window.NEXT_PUBLIC_API_BASE='${NEXT_PUBLIC_API_BASE}';" > /var/www/html/config.js
echo "window.NEXT_PUBLIC_LIDARR_BASE='${NEXT_PUBLIC_LIDARR_BASE}';" >> /var/www/html/config.js

set -Eeuo pipefail
npx -w apps/api prisma migrate deploy --schema /app/prisma/schema.prisma
node apps/api/dist/main.js & p1=$!
nginx -g "daemon off;" & p2=$!
python3 -m uvicorn main:app --host 0.0.0.0 --port 8080 & p3=$!
trap 'kill -TERM $p1 $p2 $p3 2>/dev/null || true' INT TERM
wait -n $p1 $p2 $p3
exit $?
