# Railway Operations Guide

This guide covers day-to-day Railway operations for your Rumi deployment: viewing logs, redeploying, managing environment variables, and connecting your own Git repository.

## Prerequisites

You need these from your provisioning response:

| Value | Purpose |
|-------|---------|
| `RAILWAY_TOKEN` | Deploy token for CLI operations |
| `project_id` | Your Railway project ID |
| `bot_service.id` | Service ID for targeted commands |
| `domain.webhook_url` | Your WhatsApp webhook URL |

## Setting Up Railway CLI

### Install the CLI

```bash
npm install -g @railway/cli
```

### Authenticate with Your Project Token

Two options:

**Option A: Environment Variable (Recommended)**
```bash
export RAILWAY_TOKEN=your-deploy-token
```

**Option B: Per-Command**
```bash
RAILWAY_TOKEN=xxx railway logs
```

The project token allows deployment, logs, and environment variables. It does NOT allow creating new projects or adding plugins.

## Viewing Logs

**Important**: Always specify `--service bot` to target the bot service.

```bash
# View recent logs
railway logs --service bot

# Follow logs in real-time
railway logs --service bot --follow

# View last 100 lines
railway logs --service bot --num 100
```

**Common log patterns:**

| Pattern | Meaning |
|---------|---------|
| `[webhook] Received message` | WhatsApp message arrived |
| `[error]` | Something went wrong |
| `[openai]` | LLM API call |
| `[supabase]` | Database operation |

## Redeploying Your Bot

### Method 1: Manual Deploy (CLI)

After making code changes locally:

```bash
# Run from the REPOSITORY ROOT — not from bot/
cd rumi-platform

# Deploy to Railway (always specify --service bot)
railway up --service bot
```

This pushes your local code to Railway and triggers a rebuild.

> ⚠️ **Run `railway up` from the repository root.** It uploads the CURRENT
> DIRECTORY as the build context, so running it from `bot/` uploads only `bot/`.
> The service's build command is `npm install && cd bot && npm install`, which
> then fails with `cd: bot: No such file or directory` — and the root
> `railpack.json` is missing from the upload too, so the native build deps
> (`libcairo2-dev`, `pkg-config`, …) are never installed and Railway silently
> falls back from RAILPACK to NIXPACKS. This is not hypothetical: a
> `cd bot && railway up` step in CI failed 24 times out of 24 before it was
> removed on 2026-08-18.

**Why `--service bot`?** Your Railway project has multiple services (bot, redis). Without specifying the service, Railway CLI doesn't know which one to deploy to.

### Method 2: Git-Based Auto-Deploy (Recommended)

Connect your GitHub repository for automatic deployments on every push:

1. **Push your code to your fork on GitHub:**
   ```bash
   git push origin main
   ```

2. **Connect GitHub to Railway (UI required):**
   - Go to your Railway project dashboard (URL from provisioning)
   - Click on your `bot` service
   - Go to **Settings** > **Source**
   - Click **Connect Repository**
   - Authorize Railway on GitHub if prompted
   - Select your repository and branch

3. **Configure auto-deploy:**
   - Enable **Automatic Deployments**
   - Leave the **Root Directory** EMPTY (the repository root)
   - Railway will now deploy automatically on every `git push`

   > ⚠️ Do **not** set Root Directory to `bot`. The `bot` and `sqs-worker`
   > services both build with `npm install && cd bot && npm install` and rely on
   > the root `railpack.json` for their native build deps, so both need the whole
   > repo in the build context. Setting it to `bot` breaks the build in exactly
   > the way described under Method 1.

**Note:** GitHub connection cannot be done via API. This is a one-time UI setup.

### Method 3: Redeploy Without Changes

To pick up new env vars, rebuild the current source rather than re-uploading:

```bash
# Rebuilds from the configured GitHub source — the safe default
railway redeploy --from-source --service bot
```

**Use `--from-source`, not a bare `railway redeploy`.** A bare redeploy replays
the *latest* deployment's build manifest — so if the most recent attempt failed,
the retry faithfully reproduces the failure. `--from-source` pulls the latest
commit from GitHub instead. (On 2026-08-18 a bare redeploy of `bot` failed for
exactly this reason: it replayed a broken NIXPACKS upload manifest.)

### Method 4: GitHub Actions (No UI Required)

**Removed.** A `.github/workflows/deploy.yml` used to run
`cd bot && railway up --service bot`, and it **never worked** — 24 deployments,
0 successes, from the day the `RAILWAY_TOKEN` secret was added (2026-07-13) until
it was deleted on 2026-08-18. Each push touching `bot/**` produced a good
Railway git-integration build followed ~14s later by a failed upload build, so
the newest deployment was permanently `FAILED` while the service quietly ran the
older good one. That masked a genuine outage: after the `bot` service's last
successful build on 2026-08-17, nothing it deployed could take effect, and a
corrected env var sat unapplied for 13 hours.

Use **Method 2** (Railway's native GitHub integration) — it is connected for this
project and deploys reliably on every push. If you ever genuinely need CI-driven
deploys, run `railway up` from the **repository root** (see Method 1) and make
sure Railway's own automatic deployments are turned OFF first, or every push
triggers two racing builds.

## Managing Environment Variables

### View Current Variables

```bash
railway variables --service bot
```

### Set a Variable

```bash
railway variables --service bot --set KEY=value
```

### Set Multiple Variables

```bash
railway variables --service bot --set KEY1=value1 --set KEY2=value2
```

### Common Variables to Update

| Variable | When to Change |
|----------|----------------|
| `WHATSAPP_TOKEN` | Token rotated by admin |
| `OPENROUTER_API_KEY` | Key expired or changed |
| `SONIOX_API_KEY` | New Soniox account |
| a feature's key (e.g. `KIE_API_KEY`, `GAMMA_API_KEY`) | Turning that feature on — gating is presence-based, there are no tiers |

After changing variables, the bot restarts automatically.

## Project Structure on Railway

Your provisioned project includes:

```
rumi-{name}/
├── bot            # Your WhatsApp bot (main service)
├── redis          # Redis for queues and caching
└── (stale-worker) # Optional: cron job for session cleanup
```

## Accessing Railway Dashboard (UI)

The project token allows CLI operations but NOT UI access. To access the Railway web dashboard:

### Option A: Use the Project URL

Your provisioning response includes `project.url`:
```
https://railway.com/project/{project-id}
```

This URL requires a Railway account. If you don't have UI access, you can request it from your admin.

### Option B: Request Team Invite

Contact your Rumi administrator to be invited to the "Rumi Deployments" team. Once invited:

1. Create a Railway account at [railway.app](https://railway.app)
2. Accept the team invitation
3. Access your project via the dashboard

## Troubleshooting

### "Unauthorized" Error

Your token may have expired or is incorrect:
```bash
echo $RAILWAY_TOKEN  # Verify it's set
railway whoami       # Check authentication
```

### Deployment Fails

Check the build logs:
```bash
railway logs --deployment latest
```

Common causes:
- Missing dependencies in `package.json`
- Syntax errors in code
- Missing environment variables

### Bot Not Responding

1. Check logs for errors:
   ```bash
   railway logs --follow
   ```

2. Verify WhatsApp webhook is configured:
   - Webhook URL: `https://{your-domain}/webhook`
   - Verify token matches `WEBHOOK_VERIFY_TOKEN`

3. Check service health:
   ```bash
   curl https://{your-domain}/health
   ```

### Redis Connection Failed

```bash
railway variables --service bot | grep REDIS_URL
```

Ensure `REDIS_URL` is set. If using Railway Redis, it should be auto-populated via the shared variable.

## Scaling Considerations

### Memory Limits

The default Railway plan has memory limits. If your bot crashes with OOM:

1. Check memory usage in Railway dashboard
2. Consider upgrading your Railway plan
3. Optimize heavy operations (image processing, PDF generation)

### Cold Starts

Railway may spin down idle services. First message after inactivity may take 5-10 seconds. This is normal on the free/hobby tier.

## Security Best Practices

1. **Never commit your .env file** - Use `.gitignore`
2. **Rotate tokens periodically** - Update `WHATSAPP_TOKEN` if compromised
3. **Use environment variables** - Not hardcoded secrets in code
4. **Monitor logs** - Watch for unusual patterns

## CLI Reference

**Note**: Always include `--service bot` to target the bot service.

| Command | Description |
|---------|-------------|
| `railway logs --service bot` | View logs |
| `railway logs --service bot --follow` | Stream logs |
| `railway up --service bot` | Deploy code |
| `railway variables --service bot` | List env vars |
| `railway variables --service bot --set K=V` | Set env var |
| `railway status` | Check deployment status |
| `railway rollback --service bot` | Revert to previous deployment |

## Getting Help

- **Railway Docs**: [docs.railway.app](https://docs.railway.app)
- **Rumi Issues**: [GitHub Issues](https://github.com/Orenda-Project/rumi-platform/issues)
- **Railway Discord**: [discord.gg/railway](https://discord.gg/railway)
