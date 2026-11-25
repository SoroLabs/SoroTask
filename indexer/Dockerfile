# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 – deps
#   Install production dependencies and build native modules (e.g. sqlite3).
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Add build tools for native node modules
RUN apk add --no-cache python3 make g++

COPY package*.json ./

RUN npm ci --omit=dev && npm cache clean --force

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 – final runtime
#   Minimal hardened runtime image running under non-root appuser.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Create dedicated non-root system user and group
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy prod dependencies from the deps stage with proper ownership
COPY --from=deps --chown=appuser:appgroup /app/node_modules ./node_modules

# Copy application files with proper ownership
COPY --chown=appuser:appgroup . .

# Set up ephemeral volume and data directory permissions
RUN mkdir -p /app/data /tmp && chown -R appuser:appgroup /app /tmp

VOLUME ["/tmp"]
EXPOSE 4000

# SECURITY: Run container with non-root UID/GID
USER appuser

CMD ["node", "src/index.js"]
