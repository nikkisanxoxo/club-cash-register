# Multi-stage build for Club Cash Register v3.0
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Production stage
FROM node:20-alpine

# Metadata
LABEL maintainer="club-cash-register"
LABEL description="Club Cash Register v3.0 with PostgreSQL"
LABEL version="3.0.0"

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy dependencies from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application files
COPY --chown=nodejs:nodejs server.js ./
COPY --chown=nodejs:nodejs db.js ./
COPY --chown=nodejs:nodejs schema.sql ./
COPY --chown=nodejs:nodejs public ./public

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/rooms', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })"

# Start server
CMD ["node", "server.js"]
