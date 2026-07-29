
Deploy Apartment Ledger Pro to Azure â Minimal Cost Runbook

Target monthly cost: ~$0â3 (Container Apps free grant covers low traffic; Neon Postgres free tier; ghcr.io free).

Architecture

Internet â Container App "web" (nginx, external ingress, scale-to-zero)
             ââ /api/*  â Container App "api"  (fastify, internal ingress)
             ââ /*      â Container App "ssr"  (TanStack SSR, internal ingress)
                              â
                         Neon Postgres (free, external, autosuspend)

ââââââââââââââââââââ

Part 1 â Neon Postgres (free)

1. Go to https://console.neon.tech â sign up (GitHub/Google login is fastest).
2. Create project â name it Â apartment-ledger-proÂ , pick a region close to Central India (e.g. AWS ap-southeast-1 Singapore â Neon doesn't have an India region yet, but this keeps latency low).
3. Neon creates a default database Â neondbÂ . Rename or create one called Â apartment_financeÂ  (Neon console â Databases â New database).
4. Copy the pooled connection string (Dashboard â Connection Details â toggle "Pooled connection"). It looks like:
******<host>/apartment_finance?sslmode=require
5. Save this as Â DATABASE_URLÂ  â you'll need it in Part 4.

Note: your Â backend/src/db.tsÂ  uses the standard Â pgÂ  Â PoolÂ  with Â connectionString: process.env.DATABASE_URLÂ . Neon requires SSL â the Â ?sslmode=requireÂ  in the URL handles that; no code change needed.

ââââââââââââââââââââ

Part 2 â Build & push images to GitHub Container Registry (free)

Since Docker Desktop needs to be running:

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

5. In GitHub â your profile â Packages â for each of the 3 packages â Package settings â Change visibility â set to Public (simplest â avoids needing a registry pull secret in Azure). If you'd rather keep them private, Part 4 shows how to add a registry secret.

ââââââââââââââââââââ

Part 3 â Azure prerequisites

Use a personal/non-corporate Azure subscription (not your Siemens tenant) for this, since it's a personal project.

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

ââââââââââââââââââââ

Part 4 â Create the Container Apps environment

az containerapp env create `
  -g portfolio-rg `
  -n apf-env `
  -l centralindia

Get the environment's default domain (needed for internal service-to-service URLs):

az containerapp env show -g portfolio-rg -n apf-env --query properties.defaultDomain -o tsv

Save this value â call it Â <ENV_DOMAIN>Â  (looks like Â blackforest-abc12345.centralindia.azurecontainerapps.ioÂ ).

Internal FQDNs will be:

â¢ API â Â api.internal.<ENV_DOMAIN>Â 
â¢ SSR â Â ssr.internal.<ENV_DOMAIN>Â 

ââââââââââââââââââââ

Part 5 â Deploy the Â apiÂ  Container App

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

Important â SMTP: Â mailhogÂ  (used locally for OTP emails) doesn't exist in production. Use a free-tier real SMTP provider for OTP login emails â e.g. Brevo (Sendinblue) free tier: 300 emails/day free, or Mailjet free tier: 200/day. Sign up, get SMTP host/port/user/pass, and add Â SMTP_HOSTÂ , Â SMTP_PORTÂ  as shown, plus check Â backend/src/routes/auth.tsÂ  â you may need to add Â SMTP_USERÂ /Â SMTP_PASSÂ  auth env vars and a matching code tweak if your provider requires auth (current code has no auth config â I can add that if you confirm a provider).

Generate a strong Â JWT_SECRETÂ :

[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))

ââââââââââââââââââââ

Part 6 â Run database migration + seed (one-off, not always-on)

Use Â az containerapp jobÂ  so you don't pay for an idle container:

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

Check logs:

az containerapp job execution list -g portfolio-rg -n api-migrate -o table

Repeat with Â --command "sh" "./docker-entrypoint.sh" "seed"Â  as a second job (Â api-seedÂ ) if you want the seeded superadmin â set Â SUPERADMIN_PASSWORDÂ  as a secret too.

ââââââââââââââââââââ

Part 7 â Deploy the Â ssrÂ  Container App

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

ââââââââââââââââââââ

Part 8 â Deploy the Â webÂ  (nginx) Container App â public entry point

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

This is the image I updated to read Â API_UPSTREAMÂ /Â SSR_UPSTREAMÂ  via nginx's built-in envsubst templating â no rebuild needed for different environments.

Get the public URL:

az containerapp show -g portfolio-rg -n web --query properties.configuration.ingress.fqdn -o tsv

Update the Â apiÂ  app's Â APP_URLÂ  env var to this real URL (Part 5 used a placeholder):

az containerapp update -g portfolio-rg -n api --set-env-vars APP_URL=https://<web-fqdn>

ââââââââââââââââââââ

Part 9 â Verify

curl https://<web-fqdn>/health
curl https://<web-fqdn>/api/... # any known GET endpoint

Open Â https://<web-fqdn>Â  in a browser â should load the SSR app.

ââââââââââââââââââââ

Cost-control checklist

â¢ â Â --min-replicas 0Â  on all 3 apps â $0 while idle (only pay per request/second of actual usage).
â¢ â Â --cpu 0.25 --memory 0.5GiÂ  â smallest allowed increment, keeps free-grant runway maximal.
â¢ â Neon free tier â autosuspends after 5 min idle, $0.
â¢ â ghcr.io â free for public images; free for private too up to generous limits for personal accounts.
â¢ â Â api-migrateÂ /Â api-seedÂ  as Jobs, not standing apps â $0 when not triggered.
â¢ â ï¸ Container Apps environment itself (Log Analytics workspace) has a small ingestion cost only if you generate heavy logs â negligible for a personal app; can also create env with Â --logs-destination noneÂ  to skip Log Analytics entirely and cut this to $0.

To reduce cost further, add Â --logs-destination noneÂ  in Part 4:

az containerapp env create -g portfolio-rg -n apf-env -l centralindia --logs-destination none