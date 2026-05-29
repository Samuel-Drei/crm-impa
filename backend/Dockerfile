# ── Stage 1: Build ──────────────────────────────────────────
FROM node:20-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src

RUN npx tsc || true

# ── Stage 2: Production runtime ────────────────────────────
FROM node:20-alpine

RUN apk add --no-cache openssl python3 py3-pip ffmpeg curl \
    && pip3 install --break-system-packages yt-dlp

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install tsx

# Prisma client gerado + schema
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY prisma ./prisma

# Código compilado
COPY --from=builder /app/dist ./dist

# Arquivos estáticos e diretórios necessários
COPY public ./public
RUN mkdir -p uploads sessions

EXPOSE 3333

# Entrypoint: resolve migrações falhas, aplica migrations, roda seed RBAC, inicia servidor
CMD sh -c "\
  echo '🔄 Verificando migrações...' && \
  npx prisma migrate resolve --rolled-back 20260403200825_rbac_remove_legacy_role 2>/dev/null; \
  npx prisma migrate resolve --rolled-back 20260403230738_rbac_remove_legacy_role 2>/dev/null; \
  npx prisma migrate deploy && \
  echo '🌱 Rodando seed RBAC...' && \
  npx tsx prisma/seed-rbac.ts 2>/dev/null; \
  echo '🚀 Iniciando servidor...' && \
  node dist/server.js"
