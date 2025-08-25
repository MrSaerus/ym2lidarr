# ---------- builder ----------
FROM node:20-bookworm-slim@sha256:6db5e436948af8f0244488a1f658c2c8e55a3ae51ca2e1686ed042be8f25f70a AS builder
WORKDIR /app

# OpenSSL на всякий
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

# манифесты
COPY package*.json ./
COPY tsconfig.base.json ./
COPY prisma ./prisma
COPY apps/api/package.json ./apps/api/package.json

# ставим все deps (с dev), генерим Prisma Client
RUN npm ci
RUN npx prisma generate

# код API и билд TS
COPY apps/api ./apps/api
RUN npm --workspace apps/api run build

# ---------- runner ----------
FROM node:20-bookworm-slim@sha256:6db5e436948af8f0244488a1f658c2c8e55a3ae51ca2e1686ed042be8f25f70a AS api
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
# на всякий случай OpenSSL
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates wget && rm -rf /var/lib/apt/lists/*

# прод-зависимости для API (без dev)
COPY package*.json ./
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci --omit=dev

# Копируем сгенерированный клиент
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# dist и схема
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY prisma ./prisma

# БД (SQLite) в volume
VOLUME ["/app/data"]
ENV DATABASE_URL="file:/app/data/app.db"

# Миграции при старте + запуск
CMD ["sh","-lc","npx prisma migrate deploy && node apps/api/dist/main.js"]

EXPOSE 4000
