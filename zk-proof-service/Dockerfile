# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 – deps
#   Install production dependencies.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev && npm cache clean --force

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 – final runtime
#   Minimal hardened runtime image with non-root user isolation.
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

# Set up ephemeral volume and directory permissions
RUN mkdir -p /tmp && chown -R appuser:appgroup /app /tmp

VOLUME ["/tmp"]
ENV PORT=3100
EXPOSE 3100

# SECURITY: Run container with non-root UID/GID
USER appuser

CMD ["node", "server.js"]
