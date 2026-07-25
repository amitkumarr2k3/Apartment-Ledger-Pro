# Deploy Apartment Ledger Pro to Azure — Minimal Cost Runbook

**Target monthly cost: ~$0–3** (Container Apps free grant covers low traffic; Neon Postgres free tier; ghcr.io free).

## Architecture

```
Internet → Container App "web" (nginx, external ingress, scale-to-zero)
             ├─ /api/*  → Container App "api"  (fastify, internal ingress)
             └─ /*      → Container App "ssr"  (TanStack SSR, internal ingress)
                              ↓
                         Neon Postgres (free, external, autosuspend)
```

---

## Part 1 — Neon Postgres (free)

1. Go to https://console.neon.tech → sign up (GitHub/Google login is fastest).
2. **Create project** → name it `apartment-ledger-pro`, pick a region close to Central India (e.g. **AWS ap-southeast-1 Singapore** — Neon doesn't have an India region yet, but this keeps latency low).
3. Neon creates a default database `neondb`. Rename or create one called `apartment_finance` (Neon console → Databases → New database).
4. Copy the **pooled connection string** (Dashboard → Connection Details → toggle "Pooled connection"). It looks like:
   ```
   ******<host>/apartment_finance?sslmode=require
   ```
5. Save this as `DATABASE_URL` — you'll need it in Part 4.

> Note: `backend/src/db.ts` uses the standard `pg` `Pool` with `connectionString: process.env.DATABASE_URL`. Neon requires SSL — the `?sslmode=require` in the URL handles that; no code change needed.

---

## Part 2 — Build & push images to GitHub Container Registry (free)

Since Docker Desktop needs to be running:

```powershell
# 1. Confirm Docker is running
docker version

# 2. Log in to ghcr.io (use a GitHub PAT with `write:packages` scope)
docker login ghcr.io -u <your-github-username>
# paste PAT when prompted for password

# 3. From repo root, build all three images
cd C:\Users\z003yujx\Downloads\PM_Folder\Personal_Task_Optimizer_Repo\RFP_NxtGen

docker build -t ghcr.io/<your-github-username>/apf-api:latest ./backend

docker build -t ghcr.io/<your-github-username>/apf-ssr:latest -f web/Dockerfile --target ssr .

docker build -t ghcr.io/<your-github-username>/apf-web:latest -f web/Dockerfile --target web .

# 4. Push
docker push ghcr.io/<your-github-username>/apf-api:latest
docker push ghcr.io/<your-github-username>/apf-ssr:latest
docker push ghcr.io/<your-github-username>/apf-web:latest
```

5. In GitHub → your profile → **Packages** → for each of the 3 packages → **Package settings** → **Change visibility** → set to **Public** (simplest — avoids needing a registry pull secret in Azure). If you'd rather keep them private, add a registry secret to each `az containerapp create`/`update` command via `--registry-server ghcr.io --registry-username <user> --registry-password <PAT>`.

---

## Part 3 — Azure prerequisites

Use a **personal/non-corporate Azure subscription** (not a corporate tenant) for this, since it's a personal project.

```powershell
# Log into the correct tenant/subscription
az login --tenant <your-personal-tenant-id-or-omit-for-personal-msdn>
az account set --subscription "<your-subscription-name-or-id>"

# One-time resource providers (only needed once per subscription)
az provider register --namespace Microsoft.App
az provider register --namespace Microsoft.OperationalInsights

# Install the Container Apps CLI extension
az extension add --name containerapp --upgrade

# Resource group
az group create -n portfolio-rg -l centralindia
```

---

## Part 4 — Create the Container Apps environment

```powershell
az containerapp env create `
  -g portfolio-rg `
  -n apf-env `
  -l centralindia
```

Get the environment's **default domain** (needed for internal service-to-service URLs):

```powershell
az containerapp env show -g portfolio-rg -n apf-env --query properties.defaultDomain -o tsv
```

Save this value — call it `<ENV_DOMAIN>` (looks like `blackforest-abc12345.centralindia.azurecontainerapps.io`).

Internal FQDNs will be:
- API → `api.internal.<ENV_DOMAIN>`
- SSR → `ssr.internal.<ENV_DOMAIN>`

---

## Part 5 — Deploy the `api` Container App

```powershell
az containerapp create `
  -g portfolio-rg `
  -n api `
  --environment apf-env `
  --image ghcr.io/<your-github-username>/apf-api:latest `
  --target-port 4000 `
  --ingress internal `
  --min-replicas 0 `
  --max-replicas 1 `
  --cpu 0.25 --memory 0.5Gi `
  --secrets db-url="<your-neon-connection-string>" jwt-secret="<generate-a-strong-random-string>" `
  --env-vars `
    DATABASE_URL=secretref:db-url `
    JWT_SECRET=secretref:jwt-secret `
    AUTH_ENABLED=true `
    NODE_ENV=production `
    SUPERADMIN_EMAIL=admin@example.com `
    SMTP_HOST=<your-smtp-host> `
    SMTP_PORT=587 `
    APP_URL=https://<web-app-fqdn-from-part-7>
```

> **Important — SMTP**: `mailhog` (used locally for OTP emails) doesn't exist in production. Use a free-tier real SMTP provider for OTP login emails — e.g. **Brevo (Sendinblue) free tier: 300 emails/day free**, or **Mailjet free tier: 200/day**. Sign up, get SMTP host/port/user/pass, and add `SMTP_HOST`, `SMTP_PORT` as shown, plus check `backend/src/routes/auth.ts` — you may need to add `SMTP_USER`/`SMTP_PASS` auth env vars and a matching code tweak if your provider requires auth (current code has no auth config).

Generate a strong `JWT_SECRET`:
```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
```

---

## Part 6 — Run database migration + seed (one-off, not always-on)

Use `az containerapp job` so you don't pay for an idle container:

```powershell
az containerapp job create `
  -g portfolio-rg `
  -n api-migrate `
  --environment apf-env `
  --image ghcr.io/<your-github-username>/apf-api:latest `
  --trigger-type Manual `
  --replica-timeout 300 `
  --replica-retry-limit 1 `
  --parallelism 1 `
  --replica-completion-count 1 `
  --cpu 0.25 --memory 0.5Gi `
  --secrets db-url="<your-neon-connection-string>" `
  --env-vars DATABASE_URL=secretref:db-url SEED_ON_MIGRATE=true SUPERADMIN_EMAIL=admin@example.com `
  --command "sh" "./docker-entrypoint.sh" "migrate"

# Trigger it once
az containerapp job start -g portfolio-rg -n api-migrate
```

Check logs:
```powershell
az containerapp job execution list -g portfolio-rg -n api-migrate -o table
```

Repeat with `--command "sh" "./docker-entrypoint.sh" "seed"` as a second job (`api-seed`) if you want the seeded superadmin — set `SUPERADMIN_PASSWORD` as a secret too.

---

## Part 7 — Deploy the `ssr` Container App

```powershell
az containerapp create `
  -g portfolio-rg `
  -n ssr `
  --environment apf-env `
  --image ghcr.io/<your-github-username>/apf-ssr:latest `
  --target-port 3000 `
  --ingress internal `
  --min-replicas 0 `
  --max-replicas 1 `
  --cpu 0.25 --memory 0.5Gi `
  --env-vars NODE_ENV=production PORT=3000 HOST=0.0.0.0
```

---

## Part 8 — Deploy the `web` (nginx) Container App — public entry point

```powershell
az containerapp create `
  -g portfolio-rg `
  -n web `
  --environment apf-env `
  --image ghcr.io/<your-github-username>/apf-web:latest `
  --target-port 80 `
  --ingress external `
  --min-replicas 0 `
  --max-replicas 1 `
  --cpu 0.25 --memory 0.5Gi `
  --env-vars `
    API_UPSTREAM=http://api.internal.<ENV_DOMAIN>:4000 `
    SSR_UPSTREAM=http://ssr.internal.<ENV_DOMAIN>:3000
```

This image reads `API_UPSTREAM`/`SSR_UPSTREAM` via nginx's built-in envsubst templating (`web/templates/default.conf.template`) — no rebuild needed for different environments.

Get the public URL:
```powershell
az containerapp show -g portfolio-rg -n web --query properties.configuration.ingress.fqdn -o tsv
```

Update the `api` app's `APP_URL` env var to this real URL (Part 5 used a placeholder):
```powershell
az containerapp update -g portfolio-rg -n api --set-env-vars APP_URL=https://<web-fqdn>
```

---

## Part 9 — Verify

```powershell
curl https://<web-fqdn>/health
curl https://<web-fqdn>/api/...   # any known GET endpoint
```

Open `https://<web-fqdn>` in a browser — should load the SSR app.

---

## Cost-control checklist

- ✅ `--min-replicas 0` on all 3 apps → $0 while idle (only pay per request/second of actual usage).
- ✅ `--cpu 0.25 --memory 0.5Gi` — smallest allowed increment, keeps free-grant runway maximal.
- ✅ Neon free tier — autosuspends after 5 min idle, $0.
- ✅ ghcr.io — free for public images; free for private too up to generous limits for personal accounts.
- ✅ `api-migrate`/`api-seed` as **Jobs**, not standing apps — $0 when not triggered.
- ⚠️ Container Apps environment itself (Log Analytics workspace) has a small ingestion cost only if you generate heavy logs — negligible for a personal app; can also create the environment with `--logs-destination none` to skip Log Analytics entirely and cut this to $0.

To reduce cost further, add `--logs-destination none` in Part 4:
```powershell
az containerapp env create -g portfolio-rg -n apf-env -l centralindia --logs-destination none
```
