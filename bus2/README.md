# Kerala Bus Display MVP

AdKerala â€” bus route display and advertising platform with **split control/display URLs**, driver phone sync, and optional **cloud admin dashboard**.

## Screens

| Screen | URL | Device |
|--------|-----|--------|
| Home | `/` | Setup â€” shows LAN URLs |
| **Display** | `/display` | **Bus PC** â€” passenger screen (always live) |
| **Control** | `/control` | **Driver phone** â€” routes, drive, settings |

## Quick Start

**Bus PC** â€” double-click `run.bat` (opens `/display?autofs=1` fullscreen).

The **local admin dashboard** starts automatically with `npm run dev` at **http://127.0.0.1:8787** (default API key: `local-dev-key`). Youâ€™ll also see an **Admin** card on the home page at http://127.0.0.1:5174/.

To use a **remote** cloud admin (e.g. Railway) instead, set `ADKERALA_CLOUD_URL` and disable the embedded admin with `ADKERALA_LOCAL_ADMIN=0`.

**Driver phone** â€” on the same Wiâ€‘Fi, open the **Control** URL printed in the server window, e.g.:

`http://192.168.1.10:5174/control`

Or manually:

```bash
cd bus2
npm install
npm run dev
```

## How sync works

- Both `/control` and `/display` poll `GET /api/state` every ~1.5s.
- Driver changes (route, forward, announce, settings) save to `db/info.txt` via `POST /api/state`.
- Bus display picks up changes automatically â€” no refresh needed.

## Data storage (`db/` folder)

| Location | What it stores |
|----------|----------------|
| **`db/info.txt`** | Routes, stops, ads, live sync fields (`savedAt`, `displayView`, â€¦) |
| **`db/media/`** | Ad images/videos, banner ads, announcement audio |

## Phase 1 â€” GPS, fleet cloud, per-bus commands

### Admin route & voice editing

Open **http://127.0.0.1:8787** (starts automatically with `npm run dev`) â†’ **Route editor** tab:

- Create/edit routes, start/end/middle stops (English, Malayalam, GPS)
- **Save catalog** â€” persists to cloud `store.json`
- **Push route to bus** â€” queues `UPSERT_ROUTE`; bus applies when online into `db/info.txt`
- **Assign & activate** â€” sets active route on the bus PC
- Upload **stop name audio** per stop (stored on cloud, downloaded to `db/media/stops/` when bus syncs)
- **Content gaps** tab â€” fix missing Malayalam/GPS/audio metadata

All bus data stays **local-first** (`db/info.txt` + `db/media/`). Cloud commands queue until the bus PC has internet, then sync every ~5 seconds.

### Driver GPS (phone `/control`)

- Allow location permission on the driver phone (HTTPS required except localhost).
- GPS appears on the Drive tab: coordinates, accuracy, nearest/at stop.
- Location syncs to bus display + cloud every ~5 seconds.

### Stops with coordinates

Add to stops in routes or cloud catalog:

```json
{ "en": "Kollam", "ml": "à´•àµŠà´²àµà´²à´‚", "lat": 8.8932, "lng": 76.6141, "radiusM": 80 }
```

### Run cloud admin + connect bus

**Terminal 1 â€” cloud (admin dashboard):**
```bash
cd bus2
set ADKERALA_ADMIN_KEY=your-secret-key
npm run cloud
# http://localhost:8787
```

**Terminal 2 â€” bus:**
```bash
set ADKERALA_CLOUD_URL=http://localhost:8787
set ADKERALA_BUS_ID=bus-1
set ADKERALA_ADMIN_KEY=your-secret-key
npm run dev
```

Admin dashboard tabs:
- **Fleet map** â€” live GPS for all buses
- **Live bus** â€” telemetry + passenger screen mirror
- **Ads** â€” push ads to one bus only
- **Content gaps** â€” missing Malayalam/audio; fix and push to selected bus
- **Route catalog** â€” search and assign route to one bus

### Driver: search cloud routes

On `/control` â†’ Routes tab â†’ **Cloud routes** (when cloud is configured on bus PC).

## Cloud admin dashboard (optional)

**Yes â€” remote admin over the internet is supported** via an outbound sync model (bus pushes to cloud; admin does not need direct access to the bus network).

### Architecture

```
Admin browser  â†â†’  Cloud server (hosted)  â†â†  Bus PC (outbound sync every 5s)
```

### Run cloud server locally (or deploy to Railway, Render, VPS)

```bash
npm run cloud
# Dashboard: http://localhost:8787/
```

Set environment variables:

**On cloud host:**
```bash
ADKERALA_ADMIN_KEY=your-secret-admin-key
ADKERALA_BUS_KEY=optional-bus-auth-key
PORT=8787
```

**On bus PC:**
```bash
ADKERALA_CLOUD_URL=https://your-cloud.example.com
ADKERALA_BUS_ID=bus-1
ADKERALA_BUS_KEY=optional-bus-auth-key
```

The bus server pushes telemetry (route, stop, display mode, ads count) and pulls admin commands (e.g. new ads JSON). Admin dashboard shows live online/offline status and lets you queue ad updates.

### Production notes for cloud

- Bus needs **mobile internet** (4G dongle / phone hotspot) for cloud sync.
- Deploy `cloud/` to a public HTTPS host.
- Extend admin dashboard for media upload (S3/Cloudflare R2) â€” current MVP queues ad metadata; media files must exist in `db/media/` or be added via a future upload API.

## ESP32 serial

USB serial buttons run on the **bus PC** (`/display?autofs=1`). Driver phone uses touch controls on `/control`.

## Keyboard shortcuts (control)

- **Ctrl+F** â€” trigger display-related action
- **Ctrl+E** â€” focus control (when embedded)

## MVP Notes

- Server listens on `0.0.0.0:5174` for LAN phone access.
- Use the same Wiâ€‘Fi for bus PC and driver phone.
- Do not mix `127.0.0.1` and `localhost` across tabs â€” they are different origins.

## Deploy cloud admin to Railway

**Important:** Only the **`cloud/`** admin server belongs on Railway â€” **not** the full bus app.

| Component | Where it runs | Why |
|-----------|---------------|-----|
| **Cloud admin** (`cloud/`) | Railway (HTTPS) | Fleet map, ads, route catalog, admin dashboard |
| **Bus server** (`npm run dev`) | Bus PC (local) | Passenger display, driver LAN sync, `db/` media |
| **Driver phone** | Browser â†’ bus PC LAN | Low-latency `/control` sync |

The bus app is **not ready** to replace the on-board PC with Railway alone. Buses still run `npm run dev` locally and **push outbound** to Railway.

### Readiness checklist (cloud on Railway)

| Item | Status |
|------|--------|
| Uses `PORT` from Railway | Yes |
| Binds `0.0.0.0` | Yes |
| Health check `/api/health` | Yes |
| HTTPS for driver GPS (via cloud telemetry) | Yes (Railway provides TLS) |
| Persistent data | **Add Railway Volume** (see below) |
| PostgreSQL | Not yet â€” file store for MVP |
| Media upload (S3/R2) | Not yet â€” ad JSON only |

### Step-by-step: Railway deploy

1. **Push code to GitHub** (repo root = `bus2` folder or monorepo).

2. **Create Railway project** â†’ [railway.app](https://railway.app) â†’ **New Project** â†’ **Deploy from GitHub repo**.

3. **Set root directory** to `bus2/cloud` (monorepo `adkeralav1` on GitHub):
   - Service â†’ **Settings** â†’ **Root Directory** â†’ `bus2/cloud`
   - Config-as-code: `bus2/cloud/railway.toml` (Dockerfile builder; not repo root or `cloud` alone)

4. **Environment variables** (Service â†’ **Variables**):

   | Variable | Value |
   |----------|--------|
   | `ADKERALA_ADMIN_KEY` | Long random secret (admin dashboard login) |
   | `ADKERALA_BUS_KEY` | Optional â€” same value on every bus PC |
   | `NODE_ENV` | `production` |

   Railway sets `PORT` automatically â€” do not override it.

5. **Add a Volume** (recommended â€” data survives redeploys):
   - Service â†’ **Volumes** â†’ **Add Volume**
   - Mount path: `/data`
   - Variable: `DATA_DIR` = `/data`

6. **Deploy** â†’ Railway builds from `bus2/cloud/Dockerfile` (`npm ci` + `node server.js`).

7. **Copy your public URL** e.g. `https://adkerala-cloud-production.up.railway.app`

8. **Verify:**
   ```bash
   curl https://YOUR-APP.up.railway.app/api/health
   ```
   Should return `{"ok":true,"service":"adkerala-cloud","version":2}`

### Connect each bus PC

On the bus (PowerShell), set env vars **before** `npm run dev`:

```powershell
$env:ADKERALA_CLOUD_URL="https://YOUR-APP.up.railway.app"
$env:ADKERALA_BUS_ID="bus-1"
$env:ADKERALA_ADMIN_KEY="same-secret-as-railway"
$env:ADKERALA_BUS_KEY="optional-bus-key"
npm run dev
```

Use a **unique** `ADKERALA_BUS_ID` per vehicle (`bus-1`, `bus-2`, â€¦).

For a permanent setup, set these as Windows user environment variables or a `.env` loader script.

### Admin dashboard

Open `https://YOUR-APP.up.railway.app` â†’ enter **Admin API key** â†’ select bus ID â†’ use Fleet map / Ads / Content gaps.

### Driver phone GPS over HTTPS

- Driver opens `http://192.168.x.x:5174/control` on **bus Wiâ€‘Fi** (LAN) â€” still fine for drive controls.
- GPS telemetry reaches Railway via the **bus PC cloud sync** (every ~5s), not directly from the phone to Railway.
- For phone GPS in the browser, production eventually needs HTTPS on the bus LAN or a tunnel â€” Phase 2.

### What breaks without a Volume

Railwayâ€™s disk is **ephemeral**. Without a Volume, bus telemetry, command queue, and catalog edits **reset on redeploy**. Always attach a Volume at `/data` with `DATA_DIR=/data`.

### Not on Railway yet (future)

- Full bus app hosting (unnecessary for your architecture)
- PostgreSQL for multi-region fleet
- S3/R2 for ad media uploads
- WebSocket live updates (currently poll-based)

