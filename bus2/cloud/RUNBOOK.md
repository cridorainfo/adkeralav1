# AdKerala Operations Runbook

## Claim a new bus PC

1. Install the same AdKerala Display EXE on the bus PC (no per-machine env vars required when `VITE_CLOUD_URL` is baked into the build).
2. On first boot, the display shows a **6-digit fleet code**.
3. Bus owner logs into the cloud portal → **Claim bus** → enter code and plate.
4. Bus PC polls cloud and receives `busId` + device token automatically.

## Revoke a stolen or decommissioned device

1. Owner or admin portal → Fleet → select bus → **Revoke device**.
2. Device token is invalidated; bus must be re-claimed with a new fleet code.

## Push a route or ads to a bus

1. Owner portal → select bus → Routes / Ads / Campaigns.
2. Changes queue as cloud commands; bus applies on next sync (~5s when online).

## Emergency unlink driver

- Owner portal → Fleet → **Unlink driver**, or driver app → Unlink.
- Bus display shows a new 4-digit driver pairing code.

## Release PC or driver app

```bash
git tag v1.2.0
git push origin v1.2.0
```

CI builds PC installer + driver APK and registers URLs on cloud. Use `--set-min` on `register-release.mjs` only when ready to enforce minimum versions fleet-wide.

## Health check

```bash
curl https://YOUR-CLOUD.up.railway.app/api/health/details
```

Expect `postgres: true` when `DATABASE_URL` is set, and `fleetOnline` count.

## PostgreSQL migration (one-time)

```bash
DATABASE_URL=postgres://... node cloud/scripts/migrate-json-to-pg.mjs
```

## Alert thresholds

- **>10% buses offline >5 min** — check bus internet / cloud health
- **Command backlog** — inspect pending commands per bus in admin
- **Postgres connectivity false** — Railway DB plugin / credentials
