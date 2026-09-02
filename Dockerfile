FROM node:22-alpine AS build

WORKDIR /app

# Enable a pinned pnpm via corepack so Docker builds are reproducible.
COPY package.json pnpm-lock.yaml ./
RUN corepack enable \
  && corepack prepare pnpm@10.32.1 --activate \
  && pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

FROM node:22-alpine

# The build passes the exact commit and build time so /health and every tool
# result can name the running code.
ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown
ENV SQD_GIT_SHA=$GIT_SHA
ENV SQD_BUILD_TIME=$BUILD_TIME
LABEL org.opencontainers.image.source="https://github.com/subsquid-labs/portal-mcp-server"
LABEL org.opencontainers.image.revision=$GIT_SHA
LABEL org.opencontainers.image.created=$BUILD_TIME

RUN apk add --no-cache curl

WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
COPY --from=build /app/THIRD_PARTY_NOTICES.md ./
COPY --from=build /app/node_modules ./node_modules

EXPOSE 3000

# The container must listen on every interface to be reachable; set MCP_ALLOWED_HOSTS
# (and MCP_ALLOWED_ORIGINS) for the deployment, or the server logs a startup error and
# serves without the Host and Origin allowlist. Loopback requests, such as this
# health check, always pass.
ENV MCP_BIND=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/ready || exit 1

CMD ["node", "dist/http.js"]
