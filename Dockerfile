# Monorepo deploy: build context = repo root (Railway root railway.toml).
# If Railway Root Directory is set to bus2/cloud, use bus2/cloud/Dockerfile instead.

FROM node:22-alpine AS web-build

WORKDIR /app/web

COPY bus2/cloud/web/package.json bus2/cloud/web/package-lock.json* ./
RUN npm install

COPY bus2/cloud/web/ ./
RUN npm run build

FROM node:22-alpine

WORKDIR /app

COPY bus2/cloud/package.json bus2/cloud/package-lock.json* ./
RUN npm install --omit=dev

COPY bus2/cloud/*.js ./
COPY --from=web-build /app/public ./public

ENV NODE_ENV=production
ENV HOST=0.0.0.0

EXPOSE 8787

USER node

CMD ["node", "server.js"]
