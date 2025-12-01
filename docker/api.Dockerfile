# ---------- builder ----------
FROM node:25-bookworm-slim@sha256:9d346b36433145de8bde85fb11f37820ae7b3fcf0b0771d0fbcfa01c79607909 AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY tsconfig.base.json ./
COPY prisma ./prisma
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci
RUN npx prisma generate
COPY apps/api ./apps/api
RUN npm --workspace apps/api run build

# ---------- runner ----------
FROM node:25-bookworm-slim@sha256:9d346b36433145de8bde85fb11f37820ae7b3fcf0b0771d0fbcfa01c79607909 AS api
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000 \
    DATABASE_URL="file:/app/data/app.db"

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl tini && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci --omit=dev

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY prisma ./prisma

VOLUME ["/app/data"]

ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["sh","-lc","node node_modules/prisma/build/index.js migrate deploy && node apps/api/dist/main.js"]

EXPOSE 4000
