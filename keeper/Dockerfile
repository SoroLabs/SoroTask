# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 – deps
#   Install production-only dependencies for cache-efficient builds.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Copy package manifests first for better layer caching.
COPY package*.json ./

# Install production dependencies only.
RUN npm ci --omit=dev && npm cache clean --force

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 – final runtime (Distroless)
#   Google's distroless base: no shell, no package manager, minimal attack surface.
#   Runs as non-root UID 10001 (nonroot user in distroless).
# ─────────────────────────────────────────────────────────────────────────────
FROM gcr.io/distroless/nodejs20-debian12:nonroot AS runner

WORKDIR /app

# Copy prod dependencies from the deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application files
COPY . .

# Expose metrics and health ports
EXPOSE 3000 3001

VOLUME ["/tmp"]

STOPSIGNAL SIGTERM

# SECURITY: Run as non-root UID 10001 (distroless nonroot user)
USER nonroot:nonroot

# Use explicit entrypoint for distroless
ENTRYPOINT ["node", "index.js"]