# Monorepo deploy: build context = repo root (Railway reads /railway.toml).
# Alternative: set Railway Root Directory to bus2/cloud and use bus2/cloud/Dockerfile.

FROM node:22-alpine AS web-build

WORKDIR /app/web

ARG VITE_CLOUD_URL=https://adkeralav1-production.up.railway.app
ENV VITE_CLOUD_URL=$VITE_CLOUD_URL

COPY bus2/cloud/web/package.json bus2/cloud/web/package-lock.json* ./
RUN npm install

COPY bus2/cloud/web/ ./
RUN npm run build

FROM node:22-alpine

RUN apk add --no-cache su-exec

WORKDIR /app

COPY bus2/cloud/package.json bus2/cloud/package-lock.json* ./
RUN npm install --omit=dev

COPY bus2/cloud/*.js ./
COPY bus2/cloud/db ./db/
COPY bus2/cloud/middleware ./middleware/
COPY bus2/cloud/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh && sed -i 's/\r$//' /docker-entrypoint.sh
COPY --from=web-build /app/public ./public

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV DATA_DIR=/data
ENV ADKERALA_PUBLIC_URL=https://adkeralav1-production.up.railway.app
ENV ADKERALA_ALT_URLS=https://adkerala.com

EXPOSE 8080

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "server.js"]
