# ---------- builder ----------
FROM node:25-bookworm-slim@sha256:e49fd70491eb042270f974167c874d6245287263ffc16422fcf93b3c150409d8 AS builder
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY tsconfig.base.json ./
COPY prisma.config.ts ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/api/tsconfig.json ./apps/api/tsconfig.json
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/src ./apps/api/src
COPY apps/api/jest.config.cjs ./apps/api/jest.config.cjs
COPY apps/api/jest.setup.ts ./apps/api/jest.setup.ts

RUN npm ci
RUN npx prisma generate --config prisma.config.ts
RUN npm --workspace apps/api run build

# ---------- runner ----------
FROM node:25-bookworm-slim@sha256:e49fd70491eb042270f974167c874d6245287263ffc16422fcf93b3c150409d8 AS api
WORKDIR /app

ENV NODE_ENV=production \
    PORT=4000

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates openssl tini ffmpeg \
 && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma.config.ts ./
COPY apps/api/package.json ./apps/api/package.json

RUN npm ci --omit=dev

COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/apps/api/src/prisma ./apps/api/src/prisma
COPY --from=builder /app/apps/api/src/generated ./apps/api/src/generated

VOLUME ["/app/data"]

ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["sh","-lc","npx prisma migrate deploy --config prisma.config.ts && exec node apps/api/dist/main.js"]

EXPOSE 4000