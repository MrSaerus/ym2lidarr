# ---------- builder ----------
FROM node:20.19.4@sha256:572a90df10a58ebb7d3f223d661d964a6c2383a9c2b5763162b4f631c53dc56a AS builder
WORKDIR /app

ARG NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_API_BASE=${NEXT_PUBLIC_API_BASE}

RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

# манифесты
COPY package*.json ./
COPY tsconfig.base.json ./
COPY prisma ./prisma
COPY apps/web/package.json ./apps/web/package.json
COPY apps/api/package.json ./apps/api/package.json

# ставим все deps (с dev), генерим Prisma Client
RUN npm ci
RUN npx prisma generate

# код API и билд TS
COPY apps/web ./apps/web
COPY apps/api ./apps/api
RUN npm --workspace apps/api run build
RUN npm --workspace apps/web run build

# ---------- runner ----------
FROM node:20.19.4@sha256:572a90df10a58ebb7d3f223d661d964a6c2383a9c2b5763162b4f631c53dc56a AS api_web
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV PORT_API=4000
RUN apt-get update && apt-get install -y --no-install-recommends python3.11 python3-pip python3-venv build-essential openssl ca-certificates wget && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci --omit=dev

COPY apps/pyproxy/requirements.txt .

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"
RUN pip install --no-cache-dir -r requirements.txt --require-hashes

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static

RUN mkdir -p ./apps/web/public
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY prisma ./prisma
COPY apps/pyproxy /app

VOLUME ["/app/data"]
ENV DATABASE_URL="file:/app/data/app.db"

RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["/usr/bin/tini","--"]
COPY ./docker/start.sh /app/start.sh
RUN chmod +x /app/start.sh
CMD ["/app/start.sh"]