# ---------- builder ----------
FROM node:20-alpine AS builder
WORKDIR /app

ARG NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_API_BASE=${NEXT_PUBLIC_API_BASE}

COPY package*.json ./
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci

COPY apps/web ./apps/web
RUN npm --workspace apps/web run build

# ---------- runner ----------
FROM node:20-alpine AS web
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN apk add wget
# копируем standalone-вывод next
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
# на случай, если public пустой — создадим
RUN mkdir -p ./apps/web/public
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["node","apps/web/server.js"]
