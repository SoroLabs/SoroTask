# Multi-stage build for production-ready Keeper container
# Stage 1: Dependencies
FROM node:20-alpine AS deps

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production && \
    npm cache clean --force

# Stage 2: Runner
FROM node:20-alpine AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Copy production dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application code
COPY package*.json ./
COPY index.js ./
COPY src ./src

# Create data directory for task registry persistence
RUN mkdir -p /app/data && \
    chown -R node:node /app

# SECURITY: Run as non-root user
USER node

# Expose metrics/health check port
EXPOSE 3001

# Health check using the /health endpoint
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Start the Keeper bot
CMD ["node", "index.js"]
