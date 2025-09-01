# ---------- node builder ----------
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim@sha256:363eede750b6677a578eea4373235aaa70a7df0da90b5fe77f66b3e651484f6f AS nodebuilder
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
COPY tsconfig.base.json ./
COPY prisma ./prisma
COPY apps/web/package.json ./apps/web/package.json
COPY apps/api/package.json ./apps/api/package.json

RUN npm ci \
&& npx prisma generate

COPY apps/web ./apps/web
COPY apps/api ./apps/api
RUN npm --workspace apps/api run build
RUN npm --workspace apps/web run build

# ---------- python builder ----------
FROM --platform=$BUILDPLATFORM python:3.13-slim@sha256:27f90d79cc85e9b7b2560063ef44fa0e9eaae7a7c3f5a9f74563065c5477cc24 AS pybuilder
WORKDIR /py
ENV VIRTUAL_ENV=/opt/venv
RUN python -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"
COPY apps/pyproxy/requirements.txt .
RUN pip install --no-cache-dir --require-hashes -r requirements.txt
COPY apps/pyproxy /py/app

# ---------- runner ----------
FROM --platform=$TARGETPLATFORM node:24-bookworm-slim@sha256:363eede750b6677a578eea4373235aaa70a7df0da90b5fe77f66b3e651484f6f AS api_web
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_PUBLIC_APP_VERSION=${NEXT_PUBLIC_APP_VERSION}
ENV NEXT_PUBLIC_GIT_COMMIT=${NEXT_PUBLIC_GIT_COMMIT}
ENV NEXT_PUBLIC_BUILD_DATE=${NEXT_PUBLIC_BUILD_DATE}
ENV NEXT_PUBLIC_REPO_URL=${NEXT_PUBLIC_REPO_URL}
ENV PORT_API=4000
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="/opt/venv/bin:${PATH}"

RUN apt-get update \
&& apt-get install -y --no-install-recommends python3.11 ca-certificates libssl3 tini \
&& rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci --omit=dev

COPY --from=nodebuilder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=nodebuilder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=nodebuilder /app/node_modules/prisma ./node_modules/prisma
COPY --from=nodebuilder /app/apps/web/.next/standalone ./
COPY --from=nodebuilder /app/apps/web/.next/static ./apps/web/.next/static
RUN mkdir -p ./apps/web/public
COPY --from=nodebuilder /app/apps/web/public ./apps/web/public
COPY --from=nodebuilder /app/apps/api/dist ./apps/api/dist
COPY prisma ./prisma

COPY --from=pybuilder /opt/venv /opt/venv
COPY --from=pybuilder /py/app /app

VOLUME ["/app/data"]
ENV DATABASE_URL="file:/app/data/app.db"

ENTRYPOINT ["/usr/bin/tini","--"]
COPY ./docker/start.sh /app/start.sh
RUN chmod +x /app/start.sh
CMD ["/app/start.sh"]