FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS run
WORKDIR /app
# Build facts for the in-app updater (set by CI; empty for local builds).
ARG PAGE_VERSION="" PAGE_COMMIT="" PAGE_REPO="" PAGE_IMAGE=""
ENV PAGE_VERSION=$PAGE_VERSION \
    PAGE_COMMIT=$PAGE_COMMIT \
    PAGE_REPO=$PAGE_REPO \
    PAGE_IMAGE=$PAGE_IMAGE
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    HOMEPAGE_CONFIG_DIR=/app/config \
    HOMEPAGE_DATA_DIR=/app/data
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# Run by the one-click updater in a helper container (see src/lib/update/apply.ts).
COPY --from=build --chown=node:node /app/scripts/updater.mjs ./scripts/updater.mjs
RUN mkdir -p /app/config /app/data && chown node:node /app/config /app/data
USER node
VOLUME ["/app/config", "/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/auth >/dev/null || exit 1
CMD ["node", "server.js"]
