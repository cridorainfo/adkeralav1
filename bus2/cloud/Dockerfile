FROM node:22-alpine AS web-build

WORKDIR /app/web

ARG VITE_CLOUD_URL=https://adkeralav1-production.up.railway.app
ENV VITE_CLOUD_URL=$VITE_CLOUD_URL

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
COPY db ./db/
COPY middleware ./middleware/
COPY docker-entrypoint.sh /docker-entrypoint.sh
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
