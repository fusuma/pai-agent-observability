FROM oven/bun:1 as base
WORKDIR /app

# Copy server files only
COPY apps/server/package.json apps/server/bun.lockb* ./apps/server/
RUN cd apps/server && bun install --frozen-lockfile

# Copy server source
COPY apps/server ./apps/server

# Create empty history directory for file watcher
RUN mkdir -p /app/history/raw-outputs

# Set environment - disable file watching in production
ENV PAI_DIR=/app
ENV NODE_ENV=production

# Expose port
EXPOSE 4000

# Start server
CMD ["bun", "apps/server/src/index.ts"]
