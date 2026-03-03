---
name: deploy
description: Deploy an ABF project to production. Generates Docker or cloud deployment configuration. Use when the user wants to deploy, ship, or host their ABF business.
argument-hint: "[--target docker|railway|fly]"
disable-model-invocation: true
---

# Deploy ABF Project

Generate deployment configuration for an ABF project.

## Steps

1. **Verify the project** — Check `abf.config.yaml` exists and is valid.

2. **Choose deployment target** from `$ARGUMENTS` or ask the user:
   - **Docker** (recommended) — `docker compose up`, single container
   - **Railway** — One-click cloud deploy
   - **Fly.io** — Edge deployment

3. **For Docker deployment**, generate:

   **`Dockerfile`**:
   ```dockerfile
   FROM node:20-slim
   WORKDIR /app
   COPY package.json pnpm-lock.yaml ./
   RUN corepack enable && pnpm install --frozen-lockfile --prod
   COPY . .
   RUN pnpm build
   EXPOSE 3000
   CMD ["node", "node_modules/.bin/abf", "dev"]
   ```

   **`docker-compose.yaml`**:
   ```yaml
   services:
     abf:
       build: .
       ports:
         - "3000:3000"
       volumes:
         - ./memory:/app/memory
         - ./outputs:/app/outputs
         - ./logs:/app/logs
       env_file: .env
       restart: unless-stopped
   ```

   **`.env.example`**:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   # OPENAI_API_KEY=sk-...
   # OLLAMA_BASE_URL=http://localhost:11434
   ```

4. **For production**, recommend updating `abf.config.yaml`:
   - `storage.backend: postgres` with a connection string
   - `bus.backend: redis` with a Redis URL
   - `logging.format: json` for structured logging
   - `security.auditLogging: true`

5. **Warn about**:
   - API keys must be set as environment variables (never committed)
   - Memory directory should be persisted (volume mount)
   - Consider `maxConcurrentSessions` for production load

6. **Show deployment command**:
   ```bash
   docker compose up -d
   ```
