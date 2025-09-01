# ---------- builder ----------
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim@sha256:363eede750b6677a578eea4373235aaa70a7df0da90b5fe77f66b3e651484f6f AS builder
WORKDIR /app

ARG NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_API_BASE=${NEXT_PUBLIC_API_BASE}

ARG VERSION=dev
ARG GIT_COMMIT=unknown
ARG BUILD_DATE=unknown
ARG REPO_URL=""
ENV NEXT_PUBLIC_APP_VERSION=${VERSION}
ENV NEXT_PUBLIC_GIT_COMMIT=${GIT_COMMIT}
ENV NEXT_PUBLIC_BUILD_DATE=${BUILD_DATE}
ENV NEXT_PUBLIC_REPO_URL=${REPO_URL}

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
ENV NEXT_PUBLIC_APP_VERSION=${NEXT_PUBLIC_APP_VERSION}
ENV NEXT_PUBLIC_GIT_COMMIT=${NEXT_PUBLIC_GIT_COMMIT}
ENV NEXT_PUBLIC_BUILD_DATE=${NEXT_PUBLIC_BUILD_DATE}
ENV NEXT_PUBLIC_REPO_URL=${NEXT_PUBLIC_REPO_URL}

COPY --chown=nonroot:nonroot --from=builder /app/apps/web/.next/standalone ./
COPY --chown=nonroot:nonroot --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --chown=nonroot:nonroot --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["apps/web/server.js"]
