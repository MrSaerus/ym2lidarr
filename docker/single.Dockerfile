# ---------- builder ----------
FROM node:24-bookworm-slim@sha256:cadbfafeb6baf87eaaffa40b3640209c4b7fd38cebde65059d15bc39cd636b85 AS builder
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

RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY tsconfig.base.json ./
COPY prisma ./prisma
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci
RUN npx prisma generate
COPY apps/api ./apps/api
COPY apps/web ./apps/web
RUN npm --workspace apps/api run build
RUN npm --workspace apps/web run build

# ---------- runner ----------
FROM node:24-bookworm-slim@sha256:cadbfafeb6baf87eaaffa40b3640209c4b7fd38cebde65059d15bc39cd636b85 AS api
WORKDIR /app
ENV NODE_ENV=production
ENV PORT_API=4000
ENV PORT=3000
ENV DATABASE_URL="file:/app/data/app.db"
ENV NEXT_PUBLIC_APP_VERSION=${NEXT_PUBLIC_APP_VERSION}
ENV NEXT_PUBLIC_GIT_COMMIT=${NEXT_PUBLIC_GIT_COMMIT}
ENV NEXT_PUBLIC_BUILD_DATE=${NEXT_PUBLIC_BUILD_DATE}
ENV NEXT_PUBLIC_REPO_URL=${NEXT_PUBLIC_REPO_URL}

ENV NGINX_VERSION   1.29.1
ENV NJS_VERSION     0.9.1
ENV NJS_RELEASE     1~bookworm
ENV PKG_RELEASE     1~bookworm
ENV DYNPKG_RELEASE  1~bookworm

RUN set -x \
# create nginx user/group first, to be consistent throughout docker variants
    && groupadd --system --gid 101 nginx \
    && useradd --system --gid nginx --no-create-home --home /nonexistent --comment "nginx user" --shell /bin/false --uid 101 nginx \
    && apt-get update \
    && apt-get install --no-install-recommends --no-install-suggests -y gnupg1 ca-certificates \
    && \
    NGINX_GPGKEYS="573BFD6B3D8FBC641079A6ABABF5BD827BD9BF62 8540A6F18833A80E9C1653A42FD21310B49F6B46 9E9BE90EACBCDE69FE9B204CBCDCD8A38D88A2B3"; \
    NGINX_GPGKEY_PATH=/etc/apt/keyrings/nginx-archive-keyring.gpg; \
    export GNUPGHOME="$(mktemp -d)"; \
    found=''; \
    for NGINX_GPGKEY in $NGINX_GPGKEYS; do \
    for server in \
        hkp://keyserver.ubuntu.com:80 \
        pgp.mit.edu \
    ; do \
        echo "Fetching GPG key $NGINX_GPGKEY from $server"; \
        gpg1 --batch --keyserver "$server" --keyserver-options timeout=10 --recv-keys "$NGINX_GPGKEY" && found=yes && break; \
    done; \
    test -z "$found" && echo >&2 "error: failed to fetch GPG key $NGINX_GPGKEY" && exit 1; \
    done; \
    gpg1 --batch --export $NGINX_GPGKEYS > "$NGINX_GPGKEY_PATH" ; \
    rm -rf "$GNUPGHOME"; \
    apt-get remove --purge --auto-remove -y gnupg1 && rm -rf /var/lib/apt/lists/* \
    && dpkgArch="$(dpkg --print-architecture)" \
    && nginxPackages=" \
        nginx=${NGINX_VERSION}-${PKG_RELEASE} \
        nginx-module-xslt=${NGINX_VERSION}-${DYNPKG_RELEASE} \
        nginx-module-geoip=${NGINX_VERSION}-${DYNPKG_RELEASE} \
        nginx-module-image-filter=${NGINX_VERSION}-${DYNPKG_RELEASE} \
        nginx-module-njs=${NGINX_VERSION}+${NJS_VERSION}-${NJS_RELEASE} \
    " \
    && case "$dpkgArch" in \
        amd64|arm64) \
# arches officialy built by upstream
            echo "deb [signed-by=$NGINX_GPGKEY_PATH] https://nginx.org/packages/mainline/debian/ bookworm nginx" >> /etc/apt/sources.list.d/nginx.list \
            && apt-get update \
            ;; \
        *) \
# we're on an architecture upstream doesn't officially build for
# let's build binaries from the published packaging sources
# new directory for storing sources and .deb files
            tempDir="$(mktemp -d)" \
            && chmod 777 "$tempDir" \
# (777 to ensure APT's "_apt" user can access it too)
            \
# save list of currently-installed packages so build dependencies can be cleanly removed later
            && savedAptMark="$(apt-mark showmanual)" \
            \
# build .deb files from upstream's packaging sources
            && apt-get update \
            && apt-get install --no-install-recommends --no-install-suggests -y \
                curl \
                devscripts \
                equivs \
                git \
                libxml2-utils \
                lsb-release \
                xsltproc \
            && ( \
                cd "$tempDir" \
                && REVISION="${NGINX_VERSION}-${PKG_RELEASE}" \
                && REVISION=${REVISION%~*} \
                && curl -f -L -O https://github.com/nginx/pkg-oss/archive/${REVISION}.tar.gz \
                && PKGOSSCHECKSUM="43ecd667d9039c9ab0fab9068c16b37825b15f7d4ef6ea8f36a41378bdf1a198463c751f8b76cfe2aef7ffa8dd9f88f180b958a8189d770258b5a97dc302daf4 *${REVISION}.tar.gz" \
                && if [ "$(openssl sha512 -r ${REVISION}.tar.gz)" = "$PKGOSSCHECKSUM" ]; then \
                    echo "pkg-oss tarball checksum verification succeeded!"; \
                else \
                    echo "pkg-oss tarball checksum verification failed!"; \
                    exit 1; \
                fi \
                && tar xzvf ${REVISION}.tar.gz \
                && cd pkg-oss-${REVISION} \
                && cd debian \
                && for target in base module-geoip module-image-filter module-njs module-xslt; do \
                    make rules-$target; \
                    mk-build-deps --install --tool="apt-get -o Debug::pkgProblemResolver=yes --no-install-recommends --yes" \
                        debuild-$target/nginx-$NGINX_VERSION/debian/control; \
                done \
                && make base module-geoip module-image-filter module-njs module-xslt \
            ) \
# we don't remove APT lists here because they get re-downloaded and removed later
            \
# reset apt-mark's "manual" list so that "purge --auto-remove" will remove all build dependencies
# (which is done after we install the built packages so we don't have to redownload any overlapping dependencies)
            && apt-mark showmanual | xargs apt-mark auto > /dev/null \
            && { [ -z "$savedAptMark" ] || apt-mark manual $savedAptMark; } \
            \
# create a temporary local APT repo to install from (so that dependency resolution can be handled by APT, as it should be)
            && ls -lAFh "$tempDir" \
            && ( cd "$tempDir" && dpkg-scanpackages . > Packages ) \
            && grep '^Package: ' "$tempDir/Packages" \
            && echo "deb [ trusted=yes ] file://$tempDir ./" > /etc/apt/sources.list.d/temp.list \
# work around the following APT issue by using "Acquire::GzipIndexes=false" (overriding "/etc/apt/apt.conf.d/docker-gzip-indexes")
#   Could not open file /var/lib/apt/lists/partial/_tmp_tmp.ODWljpQfkE_._Packages - open (13: Permission denied)
#   ...
#   E: Failed to fetch store:/var/lib/apt/lists/partial/_tmp_tmp.ODWljpQfkE_._Packages  Could not open file /var/lib/apt/lists/partial/_tmp_tmp.ODWljpQfkE_._Packages - open (13: Permission denied)
            && apt-get -o Acquire::GzipIndexes=false update \
            ;; \
    esac \
    \
    && apt-get install --no-install-recommends --no-install-suggests -y \
                        $nginxPackages \
                        gettext-base \
                        curl \
    && apt-get remove --purge --auto-remove -y && rm -rf /var/lib/apt/lists/* /etc/apt/sources.list.d/nginx.list \
    \
# if we have leftovers from building, let's purge them (including extra, unnecessary build deps)
    && if [ -n "$tempDir" ]; then \
        apt-get purge -y --auto-remove \
        && rm -rf "$tempDir" /etc/apt/sources.list.d/temp.list; \
    fi \
# forward request and error logs to docker log collector
    && ln -sf /dev/stdout /var/log/nginx/access.log \
    && ln -sf /dev/stderr /var/log/nginx/error.log \
# create a docker-entrypoint.d directory
    && mkdir /docker-entrypoint.d


RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl tini python3 python3-pip python3-venv build-essential wget nginx && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci --omit=dev

COPY apps/pyproxy/requirements.txt .
COPY apps/pyproxy /app

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"
RUN pip install --no-cache-dir -r requirements.txt --require-hashes

COPY --from=builder /app/apps/web/out /var/www/html

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/apps/api/dist ./apps/api/dist

COPY /docker/single/docker-entrypoint.sh /
COPY /docker/single/10-listen-on-ipv6-by-default.sh /docker-entrypoint.d
COPY /docker/single/15-local-resolvers.envsh /docker-entrypoint.d
COPY /docker/single/20-envsubst-on-templates.sh /docker-entrypoint.d
COPY /docker/single/30-tune-worker-processes.sh /docker-entrypoint.d

COPY docker/single/nginx.conf /etc/nginx/nginx.conf
COPY prisma ./prisma
COPY docker/single/start.sh /app/start.sh

RUN chmod +x /docker-entrypoint.sh
RUN chmod +x /app/start.sh

CMD ["/app/start.sh"]