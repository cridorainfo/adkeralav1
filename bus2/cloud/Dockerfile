FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js store.js ./
COPY public ./public

ENV NODE_ENV=production
ENV HOST=0.0.0.0

EXPOSE 8787

USER node

CMD ["node", "server.js"]