# ---------- builder ----------
FROM node:25-bookworm-slim@sha256:2688bfed319481b4e9c7af4d874736777c932516b55bc1b087cc4fafcbca3e5d AS builder
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
FROM node:25-bookworm-slim@sha256:2688bfed319481b4e9c7af4d874736777c932516b55bc1b087cc4fafcbca3e5d AS api
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000 \
    DATABASE_URL="file:/app/data/app.db"

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl tini ffmpeg && rm -rf /var/lib/apt/lists/*

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
