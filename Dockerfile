# syntax=docker/dockerfile:1

# ---- Stage 1: build the web app (React, charts, fonts) ----
FROM node:25-alpine AS build
WORKDIR /build
COPY app/package.json app/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY app/ ./
RUN node build-server.mjs

# ---- Stage 2: the small runtime image ----
FROM node:25-alpine
# Pick up Alpine security fixes, then remove npm: the server needs no packages at run time.
# su-exec drops to the node user after the entrypoint fixes /data ownership.
RUN apk upgrade --no-cache \
 && apk add --no-cache su-exec \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
 && mkdir -p /data && chown node:node /data && chmod 700 /data
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data WEB_DIR=/srv/web
WORKDIR /srv
# Code is owned by root and read-only to the app user.
COPY --chown=root:root --chmod=755 server/ ./server/
COPY --chown=root:root --chmod=755 entrypoint.sh /srv/entrypoint.sh
COPY --from=build --chown=root:root --chmod=755 /build/dist-server/ ./web/
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["/srv/entrypoint.sh"]
CMD ["node", "server/server.mjs"]
