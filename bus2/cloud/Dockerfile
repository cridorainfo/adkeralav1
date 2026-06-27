FROM node:22-alpine

WORKDIR /app

# Build context is the monorepo root (adkeralav1/) when deployed from GitHub.
COPY bus2/cloud/package.json bus2/cloud/package-lock.json ./
RUN npm ci --omit=dev

COPY bus2/cloud/server.js bus2/cloud/store.js ./
COPY bus2/cloud/public ./public

RUN mkdir -p /data && chown node:node /data

ENV NODE_ENV=production
ENV HOST=0.0.0.0

EXPOSE 8787

USER node

CMD ["node", "server.js"]