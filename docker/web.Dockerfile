# ---------- builder ----------
FROM --platform=$BUILDPLATFORM node:25-bookworm-slim@sha256:435f3537a088a01fd208bb629a4b69c28d85deb9a60af8a710cafc3befd6e3be AS builder
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
FROM --platform=$TARGETPLATFORM nginx:1.29.8-alpine-slim@sha256:6a9338004bea53f33e1d44a0f644ed082c3076b03747566c9535b0c724c98d09 AS web
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
