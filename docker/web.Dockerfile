# ---------- builder ----------
FROM --platform=$BUILDPLATFORM node:20-bookworm-slim@sha256:6db5e436948af8f0244488a1f658c2c8e55a3ae51ca2e1686ed042be8f25f70a AS builder
WORKDIR /app

ARG NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_API_BASE=${NEXT_PUBLIC_API_BASE}

COPY package*.json ./
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci

COPY apps/web ./apps/web
RUN npm --workspace apps/web run build

# ---------- runner ----------
FROM --platform=$TARGETPLATFORM gcr.io/distroless/nodejs20-debian12@sha256:079f8c6514d2f21e13e27a40f3e0ee0c5a12aa208d2ef5a2390e44e03e4f36c8 AS web
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --chown=nonroot:nonroot --from=builder /app/apps/web/.next/standalone ./
COPY --chown=nonroot:nonroot --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --chown=nonroot:nonroot --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["apps/web/server.js"]