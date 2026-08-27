FROM node:24-alpine AS build

WORKDIR /app

# Enable a pinned pnpm via corepack so Docker builds are reproducible.
COPY package.json pnpm-lock.yaml ./
RUN corepack enable \
  && corepack prepare pnpm@10.32.1 --activate \
  && pnpm install --frozen-lockfile

COPY . .
RUN pnpm exec tsc

FROM node:24-alpine

RUN apk add --no-cache curl

WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "dist/http.js"]
