# Deploying ABF

ABF runs as a persistent Node.js HTTP server. It cannot run on serverless
platforms (Vercel, Netlify, Cloudflare Workers). Use a platform that supports
always-on processes.

## One-Click: Railway (Recommended)

Railway is the easiest way to deploy ABF. It provides persistent processes,
managed Postgres and Redis, and a generous free tier.

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.com/deploy?repo=https://github.com/alexclowe/abf&branch=main)

### What you get
- ABF runtime running 24/7
- Optional Postgres for persistent agent memory
- Optional Redis for production message bus
- Automatic restarts on failure
- Environment variable management
- Logs and metrics dashboard

### Steps
1. Click the button above
2. Sign in to Railway (GitHub login works)
3. Set `ANTHROPIC_API_KEY` (or your preferred LLM provider key)
4. Click **Deploy**
5. Your ABF instance is live in ~2 minutes

### Adding Postgres (recommended for production)
1. In your Railway project, click **New** → **Database** → **PostgreSQL**
2. In your ABF service, add environment variable:
   `DATABASE_URL` = (copy from the Postgres service variables)
3. In `abf.config.yaml`, set `storage: { backend: postgres }`

### Adding Redis (for multi-agent workflows)
1. In your Railway project, click **New** → **Database** → **Redis**
2. In your ABF service, add environment variable:
   `REDIS_URL` = (copy from the Redis service variables)
3. In `abf.config.yaml`, set `bus: { backend: redis, url: "${REDIS_URL}" }`

### Security (important for cloud deployments)
Set `ABF_API_KEY` in Railway environment variables to require authentication
on all API endpoints:
```
ABF_API_KEY=a-long-random-string-here
```
Then include the header in Dashboard requests:
```
Authorization: Bearer a-long-random-string-here
```

---

## Render (Alternative)

Render also supports persistent Node.js services and has a free tier.

### Steps
1. Push your ABF project to a GitHub repository
2. Go to [render.com](https://render.com) → **New** → **Web Service**
3. Connect your GitHub repo
4. Set build command: `pnpm install --frozen-lockfile && pnpm build`
5. Set start command: `node packages/cli/dist/index.js dev`
6. Add `ANTHROPIC_API_KEY` environment variable
7. Click **Create Web Service**

A `render.yaml` file is included in the repository for Blueprint deployment.

---

## Fly.io

Fly.io is great for global distribution and performance.

```bash
brew install flyctl
fly auth login
fly launch  # detects Dockerfile automatically
fly secrets set ANTHROPIC_API_KEY=sk-ant-...
fly deploy
```

A `fly.toml` file is included in the repository.

---

## Docker (Self-Hosted)

```bash
# Build the image
docker build -t abf:latest .

# Run with your project directory mounted
docker run -d \
  -p 3000:3000 \
  -v ./my-project:/workspace \
  -v ~/.abf:/root/.abf \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e ABF_API_KEY=your-secret \
  --workdir /workspace \
  abf:latest

# Or use docker compose (see docker-compose.yml)
docker compose up
```

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | At least one LLM | Claude API key |
| `OPENAI_API_KEY` | At least one LLM | OpenAI API key |
| `OLLAMA_BASE_URL` | At least one LLM | Ollama server URL |
| `ABF_API_KEY` | Cloud deployments | Protects API endpoints |
| `ABF_CORS_ORIGINS` | Cloud deployments | Comma-separated allowed origins |
| `DATABASE_URL` | Production | PostgreSQL connection string |
| `REDIS_URL` | Production | Redis connection string |
| `NODE_ENV` | Production | Set to `production` |
| `PORT` | Optional | Gateway port (default: 3000) |

---

## Agent Files in Cloud Deployments

ABF loads agent definitions from the `agents/` directory at startup. In a
cloud deployment, you have two options:

1. **Include agents in your Docker image**: Fork the ABF repo, add your agent
   YAML files to `agents/`, and deploy. Railway re-deploys on git push.

2. **Mount a volume**: Use Railway's volume feature to persist `agents/`,
   `memory/`, and `logs/` between deployments.

The recommended approach for production is option 1 — treat your agent
definitions as code and deploy them with your service.
