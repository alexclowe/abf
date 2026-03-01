# Self-Hosting ABF

ABF runs as a persistent Node.js HTTP server. It requires an always-on process and cannot run on serverless platforms (Vercel, Netlify, Cloudflare Workers).

This guide covers all deployment options: Docker, Railway, Render, Fly.io, and bare-metal.

---

## Quick Reference

| Method | Best For | Effort | Cost |
|---|---|---|---|
| Docker Compose | Self-hosted production | Medium | Your infrastructure |
| Railway | Fastest cloud deploy | Low | Free tier available |
| Render | Alternative cloud | Low | Free tier available |
| Fly.io | Global distribution | Medium | Pay-per-use |
| Bare metal | Full control | High | Your infrastructure |

---

## Docker (Recommended for Self-Hosting)

### Single container

```bash
# Build the image
docker build -t abf:latest .

# Run with your project directory mounted
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/my-project:/workspace \
  -v ~/.abf:/root/.abf \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e ABF_API_KEY=your-secret-key \
  --workdir /workspace \
  --name abf \
  abf:latest
```

### Docker Compose

Every ABF project includes a `docker-compose.yml`. For a production setup with Postgres and Redis:

```yaml
# docker-compose.yml
version: '3.8'
services:
  abf:
    build: .
    ports:
      - "3000:3000"
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - ABF_API_KEY=${ABF_API_KEY}
      - DATABASE_URL=postgresql://abf:password@postgres:5432/abf
      - REDIS_URL=redis://redis:6379
      - NODE_ENV=production
    volumes:
      - ./:/workspace
      - abf-credentials:/root/.abf
    working_dir: /workspace
    depends_on:
      - postgres
      - redis

  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: abf
      POSTGRES_USER: abf
      POSTGRES_PASSWORD: password
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    volumes:
      - redisdata:/data

volumes:
  pgdata:
  redisdata:
  abf-credentials:
```

Start it:

```bash
docker compose up -d
```

Then update `abf.config.yaml` to use the production backends:

```yaml
storage:
  backend: postgres
  connection_string: postgresql://abf:password@postgres:5432/abf

bus:
  backend: redis
  url: redis://redis:6379
```

---

## Railway (One-Click Cloud)

Railway is the easiest way to deploy ABF to the cloud. It provides persistent processes, managed Postgres and Redis, and a generous free tier.

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.com/deploy?repo=https://github.com/alexclowe/abf&branch=main&envs=ABF_VAULT_PASSWORD,ANTHROPIC_API_KEY&optionalEnvs=ANTHROPIC_API_KEY&ABF_VAULT_PASSWORDDesc=Encryption+password+for+credential+vault&ANTHROPIC_API_KEYDesc=Optional+Anthropic+API+key+(can+configure+later+via+dashboard))

### Manual setup

1. Click the deploy button above (or go to [railway.app](https://railway.app))
2. Sign in with GitHub
3. Set environment variables:
   - `ANTHROPIC_API_KEY` -- Your LLM provider key
   - `ABF_VAULT_PASSWORD` -- Encryption password for the credential vault
   - `ABF_API_KEY` -- A random string to protect API endpoints
4. Click **Deploy**
5. Your ABF instance is live in about 2 minutes

### Using the CLI

```bash
abf deploy --target railway
```

This generates the `railway.json` configuration file for Railway.

### Adding Postgres

1. In your Railway project, click **New** then **Database** then **PostgreSQL**
2. Copy the `DATABASE_URL` from the Postgres service variables
3. Add it as an environment variable on your ABF service
4. Update `abf.config.yaml`:
   ```yaml
   storage:
     backend: postgres
     connection_string: ${DATABASE_URL}
   ```

### Adding Redis

1. In your Railway project, click **New** then **Database** then **Redis**
2. Copy the `REDIS_URL` from the Redis service variables
3. Add it as an environment variable on your ABF service
4. Update `abf.config.yaml`:
   ```yaml
   bus:
     backend: redis
     url: ${REDIS_URL}
   ```

---

## Render

Render supports persistent Node.js services with a free tier.

### Steps

1. Push your ABF project to a GitHub repository
2. Go to [render.com](https://render.com) and click **New** then **Web Service**
3. Connect your GitHub repository
4. Set build command: `pnpm install --frozen-lockfile && pnpm build`
5. Set start command: `node packages/cli/dist/index.js dev`
6. Add environment variables: `ANTHROPIC_API_KEY`, `ABF_API_KEY`
7. Click **Create Web Service**

### Using the CLI

```bash
abf deploy --target render
```

A `render.yaml` Blueprint file is included in the repository for automated deployment.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/alexclowe/abf)

---

## Fly.io

Fly.io is ideal for global distribution and low-latency access.

```bash
# Install Fly CLI
brew install flyctl   # macOS
# Or: curl -L https://fly.io/install.sh | sh

# Authenticate
fly auth login

# Launch (detects Dockerfile automatically)
fly launch

# Set secrets
fly secrets set ANTHROPIC_API_KEY=sk-ant-...
fly secrets set ABF_API_KEY=your-secret-key

# Deploy
fly deploy
```

### Using the ABF CLI

```bash
abf deploy --target fly
```

A `fly.toml` configuration file is included in the repository.

---

## Bare Metal / VPS

For full control, run ABF directly on a server.

### Prerequisites

- Node.js 20+
- pnpm 10+
- (Optional) PostgreSQL 15+ with pgvector extension
- (Optional) Redis 7+

### Steps

```bash
# Clone or copy your ABF project
git clone <your-project-repo> /opt/abf-project
cd /opt/abf-project

# Install ABF globally
npm install -g @abf/cli

# Configure credentials
abf auth anthropic

# Start the runtime
abf dev --port 3000
```

### systemd service (Linux)

Create `/etc/systemd/system/abf.service`:

```ini
[Unit]
Description=ABF Runtime
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=abf
WorkingDirectory=/opt/abf-project
ExecStart=/usr/bin/node /usr/lib/node_modules/@abf/cli/dist/index.js dev
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=ABF_API_KEY=your-secret-key
Environment=ANTHROPIC_API_KEY=sk-ant-...

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl enable abf
sudo systemctl start abf
sudo systemctl status abf
```

### Reverse proxy (nginx)

```nginx
server {
    listen 80;
    server_name abf.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;

        # SSE support
        proxy_buffering off;
        proxy_read_timeout 86400s;
    }
}
```

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | One LLM required | -- | Anthropic Claude API key |
| `OPENAI_API_KEY` | One LLM required | -- | OpenAI API key |
| `OLLAMA_BASE_URL` | One LLM required | `http://localhost:11434` | Ollama server URL |
| `ABF_API_KEY` | Production | -- | Protects all API endpoints with bearer auth |
| `ABF_CORS_ORIGINS` | Production | `http://localhost:3000,http://localhost:3001` | Comma-separated allowed CORS origins |
| `ABF_VAULT_PASSWORD` | If using vault | -- | Encryption password for credential vault |
| `ABF_VAULT_PATH` | Optional | `~/.abf/credentials.enc` | Custom path for credential vault file |
| `DATABASE_URL` | If using Postgres | -- | PostgreSQL connection string |
| `REDIS_URL` | If using Redis bus | -- | Redis connection string |
| `NODE_ENV` | Production | `development` | Set to `production` for production |
| `PORT` | Optional | `3000` | Gateway port |

---

## Production Checklist

Before running ABF in production, verify the following:

### Security

- [ ] `ABF_API_KEY` is set to a strong random string (32+ characters)
- [ ] `ABF_CORS_ORIGINS` is restricted to your actual domain(s)
- [ ] `NODE_ENV=production` is set
- [ ] LLM API keys are set via environment variables (not in config files)
- [ ] The credential vault password (`ABF_VAULT_PASSWORD`) is set and backed up securely
- [ ] Agent behavioral bounds are reviewed and appropriate for production

### Infrastructure

- [ ] PostgreSQL is configured for persistent memory (not filesystem)
- [ ] Redis is configured for durable message bus (not in-process)
- [ ] The process manager (systemd, Docker, Railway) restarts on failure
- [ ] Logs are being collected and retained
- [ ] Port 3000 is behind a reverse proxy with TLS (HTTPS)

### Agent Configuration

- [ ] Agent `max_cost_per_session` limits are set appropriately
- [ ] `requires_approval` is configured for sensitive actions
- [ ] Escalation rules route to a monitored channel (email, Slack, Dashboard)
- [ ] Cron schedules are set to appropriate production frequencies

### Backups

- [ ] PostgreSQL database is backed up regularly
- [ ] The `memory/` directory is backed up (if using filesystem storage)
- [ ] The `knowledge/` directory is version controlled
- [ ] Agent YAML files are version controlled
- [ ] The credential vault file (`~/.abf/credentials.enc`) is backed up

---

## Agent Files in Cloud Deployments

ABF loads agent definitions from the `agents/` directory at startup. In cloud deployments, you have two options:

1. **Include agents in your deployment** (recommended) -- Treat agent YAML files as code. Commit them to your repository and deploy with your service. Railway and Render re-deploy on git push.

2. **Mount a volume** -- Use your platform's volume feature to persist `agents/`, `memory/`, `knowledge/`, and `logs/` between deployments.

The first approach is recommended because it keeps your agent definitions version-controlled, reviewable, and reproducible.

---

## Monitoring

ABF provides built-in monitoring via the `/health` endpoint (no authentication required):

```bash
curl http://localhost:3000/health
# {"status":"ok","agents":5,"activeSessions":1,"uptime":3600.42}
```

Use this endpoint for health checks in your deployment platform. Additionally:

- The Dashboard at `http://localhost:3000` shows real-time metrics
- The SSE endpoint at `/api/events` streams runtime snapshots every 2 seconds
- Session logs are written to the `logs/` directory
- The `/api/metrics/runtime` endpoint provides aggregated statistics
