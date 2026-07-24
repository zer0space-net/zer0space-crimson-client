# zer0space ✕ Crimson — static web client.
#
# Frontend by zer0space; the streaming engine and backend it talks to are
# Crimson Haven's (https://github.com/crimsonhaven-to). Two stages: build the
# Vite SPA with Node, then serve the static output with nginx. The image is
# stateless — it is reached only through the dashboard's /crimson gate, never
# directly.

# --- build -----------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Install against the lockfile first so this layer caches across source edits.
COPY package.json package-lock.json ./
RUN npm ci

# vendor/crimson-sources (the engine submodule) is optional at this stage — no
# module imports it yet, so a checkout without submodules still builds.
COPY . .
RUN npm run build

# --- serve -----------------------------------------------------------------
FROM nginx:1.27-alpine
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/crimson.conf
COPY --from=build /app/dist /usr/share/nginx/html

# Unprivileged: nginx:alpine can run its workers as the built-in nginx user.
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=4s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1
