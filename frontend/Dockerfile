# ── Stage 1: Build ──────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Em produção, NÃO definir VITE_API_URL — o nginx faz proxy de /api e /socket.io para o backend
# O frontend usa caminhos relativos automaticamente quando VITE_API_URL está vazio

RUN npm run build

# ── Stage 2: Serve com nginx ───────────────────────────────
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
