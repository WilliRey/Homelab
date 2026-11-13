# Deploy Encore to the homelab

**Audience:** Claude Code running on the user's Linux laptop, on the same home network as the homelab. Follow the steps in order. Every step is safe to re-run.

**End state:**
- The laptop has passwordless SSH to the Proxmox host (`pve`) and to the Docker container that runs Portainer (`dockerhost`).
- Encore runs there under Docker Compose and is reachable from the phone at `https://encore.<tailnet>.ts.net` over Tailscale.
- The laptop has a one-command update script.

## The homelab

- **Proxmox VE** on a Lenovo ThinkCentre M910q (i5-6500T, 16 GB RAM, 1 TB SSD). The web UI is at `https://<PVE_IP>:8006`.
- TrueNAS runs on it. **Leave it alone.**
- An LXC container runs Docker and Portainer. Pi-hole runs on that Docker host as a container. **This LXC is the deploy target.**
- pfSense and Wazuh may exist. **Leave them alone.**
- The app code lives in the public GitHub repo `https://github.com/WilliRey/Homelab` under `apps/encore/`. `apps/encore/PLAN.md` explains how the app works.

## Ground rules

1. **Never handle secrets in chat.** Don't ask the user to paste passwords or the Tailscale key into the conversation, and don't print `.env`. When a secret is needed, give the user a command to run in **their own terminal window**, and they type it there.
2. **Claude Code can't answer interactive password prompts.** Any command that asks for a password (for example `ssh-copy-id`) is run by the user in a separate terminal. Give them the exact command, then wait for them to say "done".
3. **Ask before changing anything on the Proxmox host** other than adding the SSH key. That includes resizing or restarting a container, installing packages on the host, or touching TrueNAS, Pi-hole, or pfSense. Explain what you want to change and why.
4. **Don't stop or recreate existing containers** (Portainer, Pi-hole, anything else). Encore publishes no ports, so it can't conflict with them.
5. If something fails, show the relevant error lines and the likely cause. Only fix it yourself if the fix is inside `/opt/homelab/apps/encore` and obvious. Otherwise ask.

---

## Step 0: Ask the user for two things

- The Proxmox host's IP address: the one in `https://<IP>:8006`. Call it `PVE_IP`.
- Confirmation that they can log into that web UI as `root` with a password. They'll type that password once in Step 2.

## Step 1: Create a dedicated SSH key on the laptop

```bash
test -f ~/.ssh/homelab_ed25519 || ssh-keygen -t ed25519 -N "" -C "homelab-$(hostname)" -f ~/.ssh/homelab_ed25519
```

The key has no passphrase so that Claude Code can use it without prompting. It's only used for hosts on the home network. Tell the user this in one line.

## Step 2: The user authorizes the key on the Proxmox host (one-time password)

Tell the user to open a **separate terminal** and run:

```bash
ssh-copy-id -i ~/.ssh/homelab_ed25519.pub root@<PVE_IP>
```

They answer "yes" to the fingerprint question and type the Proxmox root password. Wait for them to say "done". Then verify it yourself:

```bash
ssh -i ~/.ssh/homelab_ed25519 -o BatchMode=yes -o StrictHostKeyChecking=accept-new root@<PVE_IP> pveversion
```

## Step 3: Add the Proxmox host to the laptop's SSH config

Append this to `~/.ssh/config` (create the file with mode 600 if it doesn't exist), unless a `Host pve` entry is already there:

```
Host pve
  HostName <PVE_IP>
  User root
  IdentityFile ~/.ssh/homelab_ed25519
  IdentitiesOnly yes
```

Check it with `ssh pve hostname`.

## Step 4: Find the Docker LXC

```bash
ssh pve 'pct list'
ssh pve 'for id in $(pct list | awk "NR>1 && \$2==\"running\"{print \$1}"); do
  echo "== CT $id: $(pct exec $id -- hostname 2>/dev/null)";
  pct exec $id -- sh -c "command -v docker >/dev/null && docker ps --format \"{{.Names}}\"" 2>/dev/null; done'
```

- The deploy target is the container whose `docker ps` lists `portainer` (and probably `pihole`). Call its ID `CTID`.
- If no container has Docker, run `ssh pve 'qm list'`. Docker may be in a VM instead. Stop and ask the user how they reach that VM.
- If several containers have Docker, ask the user which one to use.

## Step 5: Set up direct SSH into the Docker LXC

These steps only add an SSH server and an authorized key inside that container.

```bash
# 1. Make sure an SSH server is installed and running in the container
ssh pve "pct exec CTID -- sh -c 'command -v sshd >/dev/null || (apt-get update && apt-get install -y openssh-server); systemctl enable --now ssh 2>/dev/null || systemctl enable --now sshd'"

# 2. Add the laptop key for root, unless it's already there
PUB=$(cat ~/.ssh/homelab_ed25519.pub)
ssh pve "pct exec CTID -- sh -c 'mkdir -p /root/.ssh && chmod 700 /root/.ssh && touch /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys && grep -qxF \"$PUB\" /root/.ssh/authorized_keys || echo \"$PUB\" >> /root/.ssh/authorized_keys'"

# 3. Get the container's IP
ssh pve "pct exec CTID -- hostname -I"
```

Take the first IPv4 address (call it `DOCKER_IP`) and append this to `~/.ssh/config`:

```
Host dockerhost
  HostName <DOCKER_IP>
  User root
  IdentityFile ~/.ssh/homelab_ed25519
  IdentitiesOnly yes
```

Verify:

```bash
ssh -o StrictHostKeyChecking=accept-new dockerhost 'docker version --format "{{.Server.Version}}"'
```

Debian's default `PermitRootLogin prohibit-password` allows key login, so nothing in `sshd_config` needs to change. If the login is refused anyway, ask before editing `sshd_config`.

Tell the user: "If this container gets its IP from DHCP, consider reserving it in your router or pfSense so `dockerhost` keeps working."

## Step 6: Preflight checks on `dockerhost`

```bash
ssh dockerhost 'docker compose version; git --version; free -m; df -h /; nproc'
```

| Check | Requirement | If it fails |
|---|---|---|
| `docker compose version` | v2 or newer | If Docker came from Docker's apt repo: `apt-get install -y docker-compose-plugin`. Otherwise install the official compose plugin binary (a pinned release from github.com/docker/compose/releases) into `/usr/local/lib/docker/cli-plugins/docker-compose`. **Ask first.** |
| `git` | installed | `ssh dockerhost 'apt-get update && apt-get install -y git'` |
| Memory | at least 2048 MB total for the first build | Ask the user, then `ssh pve 'pct set CTID -memory 2048 -swap 1024'`. This applies live, with no restart. |
| Disk | at least 10 GB free on `/` | Ask the user, then `ssh pve 'pct resize CTID rootfs +10G'` |

**DNS and Pi-hole check.** Some Pi-hole blocklists block YouTube's video servers, which breaks playback.

```bash
ssh dockerhost 'for h in www.youtube.com youtubei.googleapis.com redirector.googlevideo.com i.ytimg.com music.youtube.com; do printf "%-28s " $h; getent hosts $h | head -1 || echo FAIL; done'
```

If any of them resolves to `0.0.0.0`, `::`, or fails: stop and ask the user to allowlist `youtube.com`, `googlevideo.com`, `youtubei.googleapis.com`, `ytimg.com`, and `music.youtube.com` in Pi-hole (Domains → Allow, as a wildcard), then re-run the check.

## Step 7: The user sets up Tailscale (in a browser, about 5 minutes)

Give the user these steps and wait for "done":

1. Create a free account at https://login.tailscale.com, or sign in.
2. Admin console → **DNS**: enable **MagicDNS**, then scroll down and enable **HTTPS Certificates**.
3. Admin console → **Settings → Keys → Generate auth key**. Leave "Reusable" off and "Ephemeral" **off**, and don't add tags. Copy the key (it starts with `tskey-auth-`). **They'll put it in the `.env` file in Step 8, not in chat.**
4. Install the **Tailscale** app on the phone and sign in with the same account.

## Step 8: Fetch the code and create `.env`

Pick the branch: use `main` if it contains the app, otherwise use the build branch.

```bash
BR=$(curl -fsS -o /dev/null https://raw.githubusercontent.com/WilliRey/Homelab/main/apps/encore/docker-compose.yml \
  && echo main || echo claude/encore-app-phases-q73wyl)
echo "Using branch: $BR"
```

Clone or update the repo on `dockerhost` and prepare the folders:

```bash
ssh dockerhost "set -e
  if [ -d /opt/homelab/.git ]; then cd /opt/homelab && git fetch origin && git checkout $BR && git pull --ff-only origin $BR;
  else git clone --branch $BR https://github.com/WilliRey/Homelab.git /opt/homelab; fi
  cd /opt/homelab/apps/encore
  test -f .env || cp .env.example .env
  chmod 600 .env
  grep -q '^SESSION_SECRET=.\{32,\}' .env || sed -i \"s|^SESSION_SECRET=.*|SESSION_SECRET=\$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')|\" .env
  mkdir -p data tailscale/state
  chown 1000:1000 data"
```

- `chown 1000:1000 data` is required. The app runs as the `node` user (uid 1000). Without it, Docker creates `data/` owned by root and the app crashes with `EACCES`.
- The session secret is generated on the server and never appears in chat.

Now tell the user to run this in **their own terminal**:

```bash
ssh -t dockerhost nano /opt/homelab/apps/encore/.env
```

They should:
- set `APP_PASSWORD=` to the password they'll use to log into Encore on the phone
- set `TS_AUTHKEY=` to the `tskey-auth-...` key from Step 7
- leave everything else as is, then save with Ctrl+O, Enter, and exit with Ctrl+X

Check the file without printing any secret:

```bash
ssh dockerhost 'cd /opt/homelab/apps/encore &&
  { grep -q "^APP_PASSWORD=change-me$" .env && echo "APP_PASSWORD still default" || echo "APP_PASSWORD ok"; } &&
  { grep -q "^APP_PASSWORD=..*" .env && echo "APP_PASSWORD set" || echo "APP_PASSWORD EMPTY"; } &&
  { grep -q "^TS_AUTHKEY=tskey-" .env && echo "TS_AUTHKEY ok" || echo "TS_AUTHKEY missing"; } &&
  { grep -q "^SESSION_SECRET=.\{32,\}" .env && echo "SESSION_SECRET ok" || echo "SESSION_SECRET missing"; }'
```

If anything reports a problem, ask the user to fix that line and check again.

## Step 9: Build and start

The first build takes about 5–15 minutes on this CPU. Run it in the background and poll.

```bash
ssh dockerhost 'cd /opt/homelab/apps/encore && nohup docker compose up -d --build > /tmp/encore-build.log 2>&1 &'
# poll every ~60 s until it finishes:
ssh dockerhost 'tail -5 /tmp/encore-build.log; cd /opt/homelab/apps/encore && docker compose ps'
```

It's done when `docker compose ps` shows `tailscale`, `encore`, and `bgutil` running, and `docker compose logs encore` contains `listening on 3000`.

If the build fails, show the failing step from `/tmp/encore-build.log`.
- If an image tag or package version no longer exists, it's fine to bump that one pin in `Dockerfile` or `docker-compose.yml` on the server. Keep the bgutil image tag and the `bgutil-ytdlp-pot-provider` pip version **equal**. Tell the user what you changed so the fix can be committed to the repo later.
- Anything bigger: ask.

## Step 10: Verify

**Health check.** Expect `ok: true`, real `ytdlpVersion` and `denoVersion` values, and `potProvider: "up"`.

```bash
ssh dockerhost 'cd /opt/homelab/apps/encore && docker compose exec -T encore node -e "fetch(\"http://127.0.0.1:3000/api/health\").then(r=>r.text()).then(console.log)"'
```

**End-to-end check: log in, search, stream.** This runs inside the container and reads the password from its environment, so nothing secret is printed.

```bash
ssh dockerhost 'cd /opt/homelab/apps/encore && docker compose exec -T encore node -e "
const b=\"http://127.0.0.1:3000\";
(async()=>{
  const l=await fetch(b+\"/api/auth/login\",{method:\"POST\",headers:{\"content-type\":\"application/json\"},body:JSON.stringify({password:process.env.APP_PASSWORD})});
  const c=(l.headers.get(\"set-cookie\")||\"\").split(\";\")[0];
  console.log(\"login\",l.status);
  const s=await fetch(b+\"/api/search?q=lofi%20hip%20hop&type=songs\",{headers:{cookie:c}});
  const j=await s.json(); const id=j.items&&j.items[0]&&j.items[0].id;
  console.log(\"search\",s.status,\"first id:\",id);
  const r=await fetch(b+\"/api/stream/\"+id+\"/audio\",{headers:{cookie:c,range:\"bytes=0-1\"}});
  console.log(\"stream\",r.status,r.headers.get(\"content-type\"),r.headers.get(\"content-range\"));
})().catch(e=>{console.error(e);process.exit(1)})"'
```

Expected output: `login 200`, `search 200` with an 11-character id, and `stream 206 audio/mp4 bytes 0-1/<number>`.
- If `stream` returns 502, check `docker compose logs --tail 100 encore`.
- If the logs mention "Sign in to confirm you're not a bot", see PLAN.md section 9.

**Tailscale check.** This prints the phone URL. It looks like `https://encore.tailXXXX.ts.net`; if the name was taken it may be `encore-1`.

```bash
ssh dockerhost 'cd /opt/homelab/apps/encore && docker compose exec -T tailscale tailscale status --self=true --peers=false && docker compose exec -T tailscale tailscale serve status'
```

## Step 11: The user finishes on the phone and in Tailscale

Give the user:

1. **Tailscale admin console → Machines → `encore` → ⋯ → Disable key expiry.** Otherwise it drops off in about 6 months.
2. On the phone, turn the Tailscale app on. Then open the URL from Step 10:
   - **iPhone:** in **Safari** (a Safari tab is the reliable mode for background audio).
   - **Android:** in Chrome.
3. The first load can take about 30 seconds while the HTTPS certificate is issued. Then log in with `APP_PASSWORD`.
4. Run the real-device checklist in `apps/encore/PLAN.md` section 11, rows 1–6 at least, and note which column passes.

## Step 12: Install a one-command updater on the laptop

```bash
mkdir -p ~/bin
cat > ~/bin/encore-update <<'EOF'
#!/usr/bin/env bash
# Pull the latest Encore code on the homelab and rebuild. Data in apps/encore/data is kept.
set -euo pipefail
ssh dockerhost 'set -e; cd /opt/homelab && git pull --ff-only
  cd apps/encore && docker compose up -d --build && docker image prune -f >/dev/null
  docker compose ps'
EOF
chmod +x ~/bin/encore-update
```

Tell the user to make sure `~/bin` is on their PATH, and give them these commands:

| Task | Command |
|---|---|
| Update after new commits | `encore-update` |
| Follow the logs | `ssh dockerhost 'cd /opt/homelab/apps/encore && docker compose logs -f --tail 100'` |
| Restart | `ssh dockerhost 'cd /opt/homelab/apps/encore && docker compose restart'` |
| Stop (data is kept) | `ssh dockerhost 'cd /opt/homelab/apps/encore && docker compose down'` |
| Switch branch (e.g. once the app is merged to `main`) | `ssh dockerhost 'cd /opt/homelab && git checkout main && git pull'`, then `encore-update` |

## Troubleshooting

| Symptom | Fix |
|---|---|
| `encore` keeps restarting, logs show `EACCES` on `/data` | `ssh dockerhost 'chown -R 1000:1000 /opt/homelab/apps/encore/data'`, then restart |
| Logs show `Invalid configuration: ...` | A line in `.env` is wrong. Have the user fix it (Step 8), then `docker compose up -d` |
| Tailscale logs say the auth key is invalid or expired | The user generates a new key and puts it in `.env`. Then `docker compose down`, `rm -rf tailscale/state/*`, `docker compose up -d` |
| The phone can't open the URL | The Tailscale app is off on the phone, or MagicDNS or HTTPS Certificates aren't enabled in the admin console (Step 7) |
| `potProvider: "down"` | `docker compose logs bgutil`, then `docker compose restart bgutil` |
| Songs stopped playing after working before | YouTube changed something and yt-dlp needs an update. Until the in-app auto-updater lands (Phase 7), bump `yt-dlp[default]==...` in the `Dockerfile` to the latest PyPI release and run `encore-update` |
| Build fails on apt, npm, or pip downloads | It's a DNS or network problem on the Docker host. Check Pi-hole and re-run the Step 6 DNS check |

## What this build includes

The code on the build branch covers PLAN.md Phases 0–3:
- login
- search (Songs, Videos, Channels, Playlists)
- Shorts filtering
- background audio playback with lock-screen controls
- queue and radio
- saved items, local playlists, and history

**Not built yet:**
- subscription feed and Takeout import (Phase 5)
- install-as-app / PWA (Phase 4)
- video mode and the disk cache (Phase 6)
- the yt-dlp auto-updater (Phase 7)

When those land, `encore-update` deploys them.
