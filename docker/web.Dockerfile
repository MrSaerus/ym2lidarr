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
FROM --platform=$TARGETPLATFORM gcr.io/distroless/nodejs20-debian12@sha256:a68373cb68a08c63bc5523d06e4c2dcd6cb0d04d1a3f8558cb5ace6fc901d27b AS web
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --chown=nonroot:nonroot --from=builder /app/apps/web/.next/standalone ./
COPY --chown=nonroot:nonroot --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --chown=nonroot:nonroot --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["apps/web/server.js"]