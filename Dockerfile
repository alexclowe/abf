# ABF — Multi-stage Docker build
# Stage 1: Build all packages (core, cli, dashboard)
# Stage 2: Lean runtime image with standalone Next.js

FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/core/package.json ./packages/core/package.json
COPY packages/cli/package.json ./packages/cli/package.json
COPY packages/dashboard/package.json ./packages/dashboard/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:20-alpine AS runtime
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
# Copy only what's needed to run
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/core/package.json ./packages/core/package.json
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=builder /app/packages/cli/package.json ./packages/cli/package.json
COPY --from=builder /app/packages/cli/dist ./packages/cli/dist
COPY --from=builder /app/packages/cli/node_modules ./packages/cli/node_modules
# Dashboard: standalone build + static assets
COPY --from=builder /app/packages/dashboard/package.json ./packages/dashboard/package.json
COPY --from=builder /app/packages/dashboard/.next/standalone ./packages/dashboard/.next/standalone
COPY --from=builder /app/packages/dashboard/.next/static ./packages/dashboard/.next/static
ENV NODE_ENV=production
EXPOSE 3000
ENTRYPOINT ["node", "/app/packages/cli/dist/index.js"]
CMD ["dev"]
