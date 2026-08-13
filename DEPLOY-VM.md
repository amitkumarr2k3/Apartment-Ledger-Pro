# Deploy Apartment Ledger Pro to a Single Azure VM (Simple Docker Compose)

**This is your existing `docker-compose.yml` running on one Linux VM instead of your
laptop — same containers (db, api, ssr, web, mailhog), same commands. No registries,
no Kubernetes, no serverless. Simplest possible path to a public URL.**

- **Cost:** ~$15–30/month depending on VM size (see Part 1).
- **Access:** `http://<VM_PUBLIC_IP>` — no domain, no HTTPS required right now.
- **Postgres:** the same `postgres:16-alpine` container from your compose file runs
  on the VM itself — no external DB service needed.
- **Tooling:** everything below uses the **Azure Portal (web browser)** for
  Azure-side setup — no Azure CLI installation required. Only plain `ssh`/`scp`
  (built into Windows) are used to reach the VM once it exists.

---

## Part 1 — Create the VM (Azure Portal — no CLI needed)

Pick a size based on your traffic. This stack runs 6 containers (db, api, ssr, web,
mailhog, plus one-off migrate/seed), so give it enough RAM to build images comfortably:

| Size | vCPU | RAM | Approx. cost (Central India) | Notes |
|---|---|---|---|---|
| `Standard_B1ms` | 1 | 2 GB | ~$15/mo | Minimum viable; slower first build |
| `Standard_B2s`  | 2 | 4 GB | ~$30/mo | **Recommended** — comfortable headroom for `vite build` |

### 1a. Generate an SSH key pair locally (Windows has OpenSSH built in — no Azure CLI needed)

In a PowerShell window on your machine:
```powershell
ssh-keygen -t ed25519 -f "$HOME\.ssh\apf_vm" -N '""'
```
This creates two files: `apf_vm` (private key — keep secret) and `apf_vm.pub` (public
key — you'll paste its contents into the portal next). View the public key:
```powershell
Get-Content "$HOME\.ssh\apf_vm.pub"
```

### 1b. Create the VM in the Azure Portal

1. Go to https://portal.azure.com and sign in with your **personal** Azure account.
2. Search the top bar for **"Virtual machines"** → click **+ Create** → **Azure virtual machine**.
3. **Basics tab:**
   - **Subscription:** your personal subscription.
   - **Resource group:** click **Create new** → name it `portfolio-rg`.
   - **Virtual machine name:** `apf-vm`
   - **Region:** `Central India` (shown as "Asia Pacific / India South Central" in some
     portal views — same region).
   - ⚠️ **Availability options:** change to **"No infrastructure redundancy required"**.
     (If left on "Availability zone", the portal restricts you to certain zone-pinned
     SKUs and may default you to a pricier size — a single low-traffic VM doesn't need
     zone redundancy.)
   - ⚠️ **Image:** must be **`Ubuntu Server 22.04 LTS - x64 Gen2`**. The portal
     sometimes defaults to **"Windows Server 2025 Datacenter"** — if you see Windows
     anywhere in this field, click it and search/select Ubuntu instead. **Windows
     Server carries a licensing fee baked into the hourly price and is a major cost
     driver if left unchanged** — this alone can 3–5x the VM cost.
   - ⚠️ **Size:** click **See all sizes** → type `B2s` (or `B1ms`) into the search box
     → select **`Standard_B2s`**. Do **not** accept a default like `Standard_D2ls_v5`
     — that's a non-burstable general-purpose SKU and costs roughly **3x more** than
     `B2s` for the same vCPU/RAM, since B-series is specifically the cheap
     "burstable" tier meant for low, spiky traffic like this app.
   - **Authentication type:** `SSH public key`
   - **Username:** `azureuser`
   - **SSH public key source:** `Use existing public key` → paste the contents of
     `apf_vm.pub` from step 1a into the box.
   - ✅ **Sanity check before continuing:** the "Size" field should now show something
     like `Standard_B2s - 2 vcpus, 4 GiB memory` with an estimated price around
     **₹2,200–2,500/month** (not ₹5,000+). If the estimate still looks high, re-check
     that Image = Ubuntu (not Windows) and Size = B-series — those two fields are
     responsible for nearly all cost differences on this page.
4. **Disks tab:** leave defaults (Standard SSD, 30 GB OS disk is fine).
5. **Networking tab:**
   - **Public IP:** leave as "New" — then click the **pencil/edit icon** next to it and
     change **SKU** to `Standard` and **Assignment** to `Static` (so the IP doesn't
     change if you stop/start the VM).
   - **NIC network security group:** `Basic`
   - **Public inbound ports:** `Allow selected ports`
   - **Select inbound ports:** check both `SSH (22)` and `HTTP (80)`.
6. Click **Review + create** → wait for validation to pass → **Create**.
7. Deployment takes ~1–2 minutes. When done, click **Go to resource**.
8. On the VM's **Overview** page, copy the **Public IP address** shown there — you'll
   use this (`<VM_PUBLIC_IP>`) for the rest of this guide.

> 💡 **To save money when you're not actively using it:** on the VM's Overview page,
> click **Stop** (this deallocates the VM — compute charges stop, only a small amount
> of storage cost remains). Click **Start** later to resume; with a Static public IP
> the address stays the same across stop/start.

---

## Part 2 — Install Docker on the VM

SSH in:
```powershell
ssh -i "$HOME\.ssh\apf_vm" azureuser@<VM_PUBLIC_IP>
```

Once connected (all commands below run **on the VM**):
```bash
# Install Docker Engine + Compose plugin (official convenience script)
curl -fsSL https://get.docker.com | sudo sh

# Let your user run docker without sudo
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker version
docker compose version
```

---

## Part 3 — Get the code onto the VM

Option A — clone from GitHub (recommended, makes future updates a one-liner):
```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/amitkumarr2k3/Apartment-Ledger-Pro.git app
cd app
```
> If the repo is private, generate a GitHub PAT (repo scope) and use:
> `git clone https://<PAT>@github.com/amitkumarr2k3/Apartment-Ledger-Pro.git app`

Option B — copy your local working directory as-is (from your Windows machine, in a **new** PowerShell window, not the SSH session):
```powershell
scp -i "$HOME\.ssh\apf_vm" -r "C:\Users\z003yujx\Downloads\PM_Folder\Personal_Task_Optimizer_Repo\RFP_NxtGen" azureuser@<VM_PUBLIC_IP>:~/app
```

---

## Part 4 — Configure production environment variables

On the VM, inside `~/app`:
```bash
cp .env.example .env
nano .env
```

Set these values (generate strong random strings for secrets):
```bash
DATABASE_URL=******db:5432/apartment_finance
JWT_SECRET=<paste output of: openssl rand -base64 48>
SUPERADMIN_EMAIL=admin@example.com
SUPERADMIN_PASSWORD=<pick a strong password>
SMTP_HOST=mailhog
SMTP_PORT=1025
APP_URL=http://<VM_PUBLIC_IP>
```

> **Note on email/OTP login:** `mailhog` only captures emails locally — it does **not**
> deliver real emails to residents. It's fine to start with (superadmin password login
> still works via the UI without OTP), but for residents to actually receive OTP codes
> you'll eventually want a real SMTP provider (e.g. free tiers from Brevo or Mailjet).
> That's a config-only change later (`SMTP_HOST`/`SMTP_PORT` + optional auth) — not
> needed to get the app running today.

---

## Part 5 — Expose the web container on port 80

Your compose file publishes `web` on host port `8090` today (matches your local
setup). For a clean `http://<IP>` URL (no `:8090`), add a small override file instead
of editing `docker-compose.yml` (keeps your local dev setup untouched):

```bash
cat > docker-compose.prod.yml <<'EOF'
services:
  web:
    ports:
      - "80:80"
EOF
```

---

## Part 6 — Build and start everything

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

This builds the `api`, `ssr`, and `web` images directly on the VM (same Dockerfiles
you already use locally) and starts all services, including one-off `migrate` and
`seed` containers that run once and exit — exactly like your local `docker compose up`.

Watch it come up:
```bash
docker compose ps
docker compose logs -f api ssr web
```

---

## Part 7 — Verify

From your own machine (not the VM):
```powershell
curl http://<VM_PUBLIC_IP>/health
```
Then open `http://<VM_PUBLIC_IP>` in a browser — the app should load, and you can log
in with `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` from your `.env`.

---

## Part 8 — Keep it running & update later

- **Survives reboot:** `restart: unless-stopped` is already set on all long-running
  services in `docker-compose.yml`, and the Docker daemon starts on boot by default
  on Ubuntu — no extra action needed.
- **Deploying a code change:**
  ```bash
  cd ~/app
  git pull
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
  ```
- **Database backups:** reuse the script already in this repo —
  ```bash
  ./scripts/db-cleanup.sh --backup-only
  ```
  This writes a `.sql.gz` dump to `scripts/backups/`. Copy backups off the VM
  periodically (e.g. `scp` to your laptop, or upload to Azure Blob Storage) since
  they currently only live on the VM's disk.

---

## Part 9 — Basic security hardening (recommended, still simple)

**Restrict SSH to only your IP (Azure Portal):**
1. Find your current public IP: open https://ifconfig.me in a browser and note the address.
2. In the Azure Portal, go to your VM (`apf-vm`) → left menu → **Networking** →
   **Network settings** tab.
3. Under **Inbound port rules**, find the rule for port `22` (SSH) → click it → **Edit** (pencil icon).
4. Change **Source** from `Any` to `IP Addresses`, and set **Source IP addresses/CIDR
   ranges** to `<your-ip>/32`.
5. Click **Save**.

**Enable automatic security updates (on the VM, via SSH):**
```bash
sudo apt-get install -y unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

---

## Part 10 — Enable HTTPS with Let's Encrypt (free TLS certificate)

**Requirements before starting:**
- You need a **domain name** (e.g. `apf.yourdomain.com`) with its **DNS A-record pointing to your VM's public IP**. Let's Encrypt verifies domain ownership; it does not work with bare IP addresses.
- Port **443 must be open** in the Azure NSG (step 10a below).

### 10a. Open port 443 in the Azure NSG

1. Azure Portal → your VM (`apf-vm`) → left menu → **Networking** → **Network settings**.
2. Under **Inbound port rules** → **+ Add inbound port rule**.
3. Set: **Destination port ranges** = `443`, **Protocol** = `TCP`, **Action** = `Allow`, **Priority** = `310`, **Name** = `HTTPS`.
4. Click **Add** and wait ~30 seconds for the rule to apply.

### 10b. Install certbot on the VM

```bash
# SSH in if not already connected
ssh -i "$HOME/.ssh/apf_vm" azureuser@<VM_PUBLIC_IP>

# Install certbot (Ubuntu 22.04)
sudo apt-get update
sudo apt-get install -y certbot
```

### 10c. Obtain the TLS certificate (one-time)

Stop the containers first so certbot can bind to port 80:
```bash
cd ~/app
docker compose -f docker-compose.yml -f docker-compose.prod.yml down
```

Get the certificate (replace `apf.yourdomain.com` with your actual domain):
```bash
sudo certbot certonly --standalone -d apf.yourdomain.com
```

Certbot will:
1. Temporarily start its own HTTP server on port 80
2. Contact Let's Encrypt to verify domain ownership
3. Write certs to `/etc/letsencrypt/live/apf.yourdomain.com/`

> If this fails with "port 80 already in use", make sure you ran `docker compose down` first.

### 10d. Set DOMAIN in your .env

```bash
nano ~/app/.env
```

Add or update these two lines:
```
DOMAIN=apf.yourdomain.com
APP_URL=https://apf.yourdomain.com
```

### 10e. Restart the stack with the HTTPS overlay

```bash
cd ~/app
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.https.yml \
  up -d --build
```

This rebuilds the web image and starts nginx with the HTTPS template (TLS on port 443 + HTTP-to-HTTPS redirect on port 80).

### 10f. Verify

```powershell
# From your own machine (not the VM)
curl https://apf.yourdomain.com/health
```

Open `https://apf.yourdomain.com` in a browser — you should see a padlock. All HTTP links will auto-redirect to HTTPS.

### 10g. Automatic certificate renewal

Let's Encrypt certificates expire after 90 days. Set up a cron job on the VM to renew automatically:

```bash
sudo crontab -e
```

Add this line (runs twice daily, renews only when <30 days left):
```cron
0 3,15 * * * certbot renew --pre-hook "cd /home/azureuser/app && docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.https.yml down" --post-hook "cd /home/azureuser/app && docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.https.yml up -d" --quiet
```

> The pre-hook stops the stack (frees port 80 for certbot's standalone renewal), and the post-hook restarts it with fresh certs.

### 10h. Update future deploys

When deploying code changes, use the same three-file command:
```bash
cd ~/app
git pull
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.https.yml \
  up -d --build
```

---

## Cost summary

| Item | Cost |
|---|---|
| VM (`Standard_B2s`, running 24/7) | ~$30/mo |
| VM (`Standard_B1ms`, running 24/7) | ~$15/mo |
| Static public IP | ~$3/mo |
| Disk (default 30 GB) | ~$2/mo |
| **Total** | **~$18–35/mo**, or $0 compute when deallocated |

This is simpler to operate day-to-day than the Container Apps approach (no
registries, no separate managed Postgres, one `docker compose` command to update)
at the cost of paying for the VM even when idle (unless you deallocate it manually).
