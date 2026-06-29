# AdKerala Bus PC — Install once, update remotely

One system for all buses. No git, npm, or env vars on the bus PC.

---

## Roles

| Who | Does what |
|-----|-----------|
| **Field staff** | Install the app once per bus, claim with fleet code |
| **Admin (you)** | Ship updates with one command; monitor fleet in dashboard |

---

## Field staff — install a new bus (one time)

1. Open **AdKerala admin** → **Fleet** tab.
2. Click **Download v…** in the “Add a new bus” steps (or get the link from admin).
3. Run **`AdKeralaDisplay-Setup-X.Y.Z.exe`** on the bus computer (double-click, Next/Finish).
4. The passenger screen shows a **6-digit fleet code**.
5. Admin or owner **claims the bus** in the portal with that code + plate number.
6. Done. The app starts on boot, connects to cloud, and **updates itself** after that.

**Do not use** `run.bat`, `npm run dev`, or portable folders on production buses.

---

## Admin — ship a software update (one command)

From your dev machine, in the `bus2` folder:

```bash
cd bus2
npm run ship -- 1.2.0
```

Replace `1.2.0` with the new version number.

That single command:

1. Creates git tag `v1.2.0`
2. Pushes the tag to GitHub
3. GitHub Actions builds the PC installer + driver APK
4. Publishes files to **GitHub Releases**
5. Registers the download URL on **cloud admin** (needs repo secrets below)
6. Redeploys cloud to Railway (if `RAILWAY_TOKEN` is set)

### One-time GitHub secrets (Settings → Secrets)

| Secret | Value |
|--------|--------|
| `ADKERALA_CLOUD_URL` | Your cloud URL, e.g. `https://adkerala.com` or Railway URL |
| `ADKERALA_ADMIN_KEY` | Same as cloud `ADKERALA_ADMIN_KEY` |
| `RAILWAY_TOKEN` | Optional — auto-deploys cloud on each release |

### After shipping

1. GitHub → **Actions** → wait for **Release** workflow (≈10–20 min).
2. Cloud admin → **Releases** tab → confirm **Latest PC v1.2.0**.
3. Optional: click **Push update to all buses now** — restarts fleet within ~2 minutes to install immediately.

Without step 3, buses still update automatically (check every **15 minutes**, restart **3 minutes** after download).

---

## How auto-update works on the bus PC

```
Admin: npm run ship -- 1.2.0
        ↓
GitHub Actions → cloud stores latest.yml + download URL
        ↓
Bus PC (installed app) polls cloud every 15 min
        ↓
Downloads new .exe in background
        ↓
Shows “Restarting in …” on passenger screen
        ↓
Restarts and installs (routes/ads in db/ are kept)
```

- **Internet required** on the bus (4G dongle / hotspot).
- **No RDP** needed — buses pull updates outbound.
- Admin can **force restart** via Releases → **Push update to all buses now**.

---

## Admin dashboard — Releases tab

| Column | Meaning |
|--------|---------|
| **App version** | Version reported by the bus PC |
| **Status `current`** | On latest release |
| **Status `outdated`** | Newer release available |
| **Status `below-minimum`** | Below min version you set |

Set **minimum versions** to flag buses that must upgrade.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Bus never updates | Must use **installed .exe**, not dev mode. Bus needs internet. |
| Releases tab shows no download link | Run `npm run ship` and check GitHub Actions + secrets |
| Fleet stuck on old version | Releases → **Push update to all buses now** |
| `npm run ship` fails “uncommitted changes” | Commit your bus2 changes first |

---

## Repository layout (no separate PC repo needed)

Everything stays in **`bus2/`** inside your existing git repo:

| Path | Purpose |
|------|---------|
| `bus2/kiosk/` | Electron bus PC app |
| `bus2/cloud/` | Admin server + Releases API |
| `bus2/scripts/ship-release.mjs` | One-command release |
| `.github/workflows/release.yml` | CI build + register |

A separate git repo for PC software is **not required**.
