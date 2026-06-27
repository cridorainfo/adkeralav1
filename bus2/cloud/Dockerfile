FROM node:22-alpine AS web-build

WORKDIR /app/web

COPY web/package.json web/package-lock.json* ./
RUN npm install

COPY web/ ./
RUN npm run build

FROM node:22-alpine

RUN apk add --no-cache su-exec

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY *.js ./
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
COPY --from=web-build /app/public ./public

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV DATA_DIR=/data

EXPOSE 8787

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "server.js"]
