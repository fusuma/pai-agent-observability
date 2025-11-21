FROM oven/bun:1 as base
WORKDIR /app

# Copy server files only
COPY apps/server/package.json apps/server/bun.lockb* ./apps/server/
RUN cd apps/server && bun install --frozen-lockfile

# Copy server source
COPY apps/server ./apps/server

# Expose port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:4000/health || exit 1

# Start server
CMD ["bun", "apps/server/src/index.ts"]
