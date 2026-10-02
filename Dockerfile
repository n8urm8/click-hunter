# Click Hunter web app image: Vite SPA served by nginx.
# Point the build at a reachable Convex backend (defaults suit `docker compose up`):
#   docker build --build-arg VITE_CONVEX_URL=https://convex.example.com -t click-hunter-web .
FROM node:24-alpine AS build
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG VITE_CONVEX_URL=http://127.0.0.1:3210
ARG VITE_CONVEX_SITE_URL=http://127.0.0.1:3211
ARG VITE_APP_TITLE="Click Hunter"
ARG VITE_DEBUG_MODE=false
ENV VITE_CONVEX_URL=${VITE_CONVEX_URL} \
    VITE_CONVEX_SITE_URL=${VITE_CONVEX_SITE_URL} \
    VITE_APP_TITLE=${VITE_APP_TITLE} \
    VITE_DEBUG_MODE=${VITE_DEBUG_MODE}
RUN pnpm build

FROM nginx:alpine AS runtime
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
