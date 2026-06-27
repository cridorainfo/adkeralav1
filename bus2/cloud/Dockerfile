FROM node:22-alpine AS web-build

WORKDIR /app/web

COPY web/package.json web/package-lock.json* ./
RUN npm install

COPY web/ ./
RUN npm run build

FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.js store.js auth.js users.js campaigns.js releases.js ./
COPY --from=web-build /app/public ./public

ENV NODE_ENV=production
ENV HOST=0.0.0.0

EXPOSE 8787

USER node

CMD ["node", "server.js"]
