# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 – Dependencies
#   Install production-only dependencies for the SoroTask Keeper service.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

COPY keeper/package*.json ./
RUN npm ci --omit=dev --workspaces=false --legacy-peer-deps && npm cache clean --force

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 – Hardened Production Runtime
#   Minimal non-root container with graceful SIGTERM draining and healthcheck.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production \
    METRICS_PORT=3001 \
    SHUTDOWN_DRAIN_TIMEOUT_MS=30000

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=deps --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --chown=appuser:appgroup keeper/ ./

RUN mkdir -p /app/data /tmp && chown -R appuser:appgroup /app /tmp

VOLUME ["/tmp"]
EXPOSE 3001

STOPSIGNAL SIGTERM

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

USER appuser

CMD ["node", "index.js"]
