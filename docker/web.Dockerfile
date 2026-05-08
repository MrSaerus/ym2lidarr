# ---------- builder ----------
FROM --platform=$BUILDPLATFORM node:26-bookworm-slim@sha256:26e5b97944df46993723cd5dc48e837b290a0e0137f305405cd342d75c404398 AS builder
WORKDIR /app

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
FROM --platform=$TARGETPLATFORM nginx:1.29.8-alpine-slim@sha256:c9366b8c560169b101ca0e5422ed063b20779e6454c2326b9c9704225c9b0c08 AS web
WORKDIR /var/www/html
ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_PUBLIC_APP_VERSION=${NEXT_PUBLIC_APP_VERSION}
ENV NEXT_PUBLIC_GIT_COMMIT=${NEXT_PUBLIC_GIT_COMMIT}
ENV NEXT_PUBLIC_BUILD_DATE=${NEXT_PUBLIC_BUILD_DATE}
ENV NEXT_PUBLIC_REPO_URL=${NEXT_PUBLIC_REPO_URL}


COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/entrypoint.sh /docker-entrypoint.d/
RUN chmod +x /docker-entrypoint.d/entrypoint.sh
COPY --from=builder --chown=nginx /app/apps/web/out .

EXPOSE 3000
