# Build client
FROM oven/bun:1 as client-builder
WORKDIR /app
COPY apps/client/package.json apps/client/bun.lock* ./apps/client/
RUN cd apps/client && bun install
COPY apps/client ./apps/client
RUN cd apps/client && bun run build

# Build server
FROM oven/bun:1 as base
WORKDIR /app

# Install build dependencies for native modules (node-pty)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy server files
COPY apps/server/package.json apps/server/bun.lock* ./apps/server/
RUN cd apps/server && bun install

# Copy server source
COPY apps/server ./apps/server

# Copy built client
COPY --from=client-builder /app/apps/client/dist ./apps/client/dist

# Create empty history directory for file watcher
RUN mkdir -p /app/history/raw-outputs /root/.claude

# Set environment
ENV PAI_DIR=/app
ENV NODE_ENV=production

# Expose port
EXPOSE 4000

# Start server
CMD ["bun", "apps/server/src/index.ts"]
