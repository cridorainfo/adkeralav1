# How to update AdKerala — plain guide

There are **two completely different kinds of update**, and they work differently. Read
the first section to figure out which one you need, then jump to that section only.

---

## Which kind of update do I need?

Ask yourself: **did the change touch the bus display app itself, or just the admin
website?**

| If the change was about... | It's a... |
|---|---|
| The admin dashboard, Campaigns/Pricing/Ads/Reports pages, login, anything you see at `adkerala.com/admin` or `adkerala.com/advertiser` | **Cloud update** — go to [Part 1](#part-1--cloud-update-admin-website) |
| The bus PC screen itself — the passenger display, route/stop logic, the kiosk app that runs on the bus computer | **PC update** — go to [Part 2](#part-2--pc-app-update-bus-computers) |
| Both (rare) | Do **both** parts, in either order |

If you're not sure, that's fine — ask whoever made the code change (or Claude) "is this a
cloud-only change or does it touch the bus PC app?" before you proceed. Doing a Part 1
update when a PC change was needed just means the PC fix doesn't go out yet (harmless).
Doing a Part 2 update for a cloud-only change is also harmless, just slower and makes
every bus download a new install for no reason — so it's worth asking first.

---

## Part 1 — Cloud update (admin website)

Use this for anything on the admin/advertiser website only. **This never touches any
bus** — no bus restarts, no reclaiming, nothing changes for drivers.

### Steps

1. Open a terminal in the `bus2` folder.
2. Make sure the code change is saved and committed. If you're not sure how, just ask
   Claude Code to "commit this fix."
3. Push it:
   ```
   git push origin main
   ```
4. That's it. Wait about **1–2 minutes** — GitHub automatically builds and deploys the
   website in the background.

### How to check it worked

- Go to **github.com/cridorainfo/adkeralav1 → Actions tab**.
- Look for a run named **"Deploy Cloud"** at the top of the list.
- A green checkmark ✓ means it's live. A red X means something failed — ask Claude Code
  to look into the failed run.
- Or just wait 2 minutes and refresh the admin dashboard yourself — the fix should be
  there.

You do **not** need to pick a version number, run any build command, or tell the buses
anything for this kind of update.

---

## Part 2 — PC app update (bus computers)

Use this only when the actual bus display software changed. This **does** update every
bus in the fleet — but safely: buses download it in the background and only install
between trips, never mid-route, and they keep their claim (no re-claiming needed).

### Steps

1. Open a terminal in the `bus2` folder.
2. Decide the next version number. Look at the current version (ask Claude, or check
   the small `vX.Y.Z` label in the corner of any bus's screen, or the admin **Releases**
   tab). For an ordinary fix, just bump the **last** number by one — e.g. `1.0.9` →
   `1.0.10`.
3. Run (replace `1.0.10` with your chosen number):
   ```
   npm run ship -- 1.0.10
   ```
4. Wait **10–20 minutes** — GitHub builds the Windows installer and publishes it
   automatically. You don't need to do anything else during this wait.

### How to check it worked

- **github.com/cridorainfo/adkeralav1 → Actions tab** → look for a run named
  **"Release"** matching your version tag (e.g. `v1.0.10`).
- All three jobs should turn green: *Build PC installer*, *GitHub Release + cloud
  register*, *Deploy cloud to Railway*.
- Admin dashboard → **Releases** tab → confirm it now shows your new version as the
  latest.

### What happens on the buses after this

- Nothing you need to do. Every bus checks for updates automatically (once at power-on,
  then every ~15 minutes while running).
- It downloads the new version quietly in the background, then installs it **the next
  time the bus is not on an active trip** (parked, between routes, or at power-on) —
  never while passengers are on board.
- The bus keeps its claim the whole time. No 6-digit code, no re-claiming.
- If a fix is urgent and you don't want to wait for the ~15-minute check: admin
  dashboard → **Releases** tab → **"Push update to all buses now."** Even this still
  waits for each bus to be between trips before actually restarting.

### Installing on a brand-new bus (one time only, per bus)

1. Download the installer: admin dashboard → **Fleet** tab → **"Download v…"** link (or
   grab `AdKeralaDisplay-Setup-X.Y.Z.exe` from the GitHub Releases page).
2. Copy it to the bus computer, double-click it, click through Next/Finish.
3. The bus screen shows a 6-digit code — enter that code + the bus's plate number in the
   admin **Fleet** tab to claim it.
4. Done, forever. From now on this bus updates itself following Part 2 above — you
   never touch this PC again for updates.

**Important:** always use the official installer (`AdKeralaDisplay-Setup-X.Y.Z.exe`).
Never copy a raw unpacked/portable folder onto a bus PC as its permanent install — that
kind of copy can't auto-update safely and will need re-claiming every time.

---

## Quick reference

| I want to... | Command | Time | Touches buses? |
|---|---|---|---|
| Fix something on the admin website | `git push origin main` | ~2 min | No |
| Fix/improve the bus display app | `npm run ship -- X.Y.Z` | ~15 min | Yes, safely |
| Force buses to update right now | Admin → Releases → "Push update to all buses now" | Immediate (still waits for each bus to be idle) | Yes |
| Install on a brand-new bus | Run the Setup.exe once, claim with the 6-digit code | ~1 min | That bus only, once |
