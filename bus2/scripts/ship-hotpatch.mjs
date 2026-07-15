#!/usr/bin/env node
/**
 * Ship a server-only hot patch — reaches buses within minutes, applied automatically
 * (even mid-route) without any installer/restart the passenger display would show.
 *
 * Usage:
 *   npm run ship:hotpatch -- 1.0.15.1
 *
 * Scope is fixed and intentionally narrow — see kiosk/hotpatchSupervisor.cjs's own
 * comment for why: only server/, src/store/, src/lib/, shared/, cloud/shared/hub/, and
 * package.json (needed for the "#hub/*" subpath-imports map to resolve). If your change
 * touches anything else — kiosk/** (Electron shell), src/pages/ or src/components/
 * (frontend UI), a new/changed npm dependency, or a db/info.txt schema change — this is
 * the wrong tool; use `npm run ship -- X.Y.Z` (full release) instead.
 *
 * This creates git tag hotpatch-v1.0.15.1 and pushes it. GitHub Actions then (see
 * .github/workflows/hotpatch.yml):
 *   - zips the patch-scope directories (no Windows build needed — plain ubuntu-latest,
 *     which is most of why this is faster than a full release)
 *   - publishes it as a GitHub Release asset
 *   - registers it on the cloud admin so buses pick it up on their next 5s sync tick
 */

import { execSync } from 'child_process';

const version = process.argv[2]?.trim().replace(/^hotpatch-v/i, '').replace(/^v/i, '');

if (!version || !/^\d+(\.\d+){2,4}$/.test(version)) {
  console.error('Usage: npm run ship:hotpatch -- X.Y.Z.N');
  console.error('Example: npm run ship:hotpatch -- 1.0.15.1  (base app version + an incrementing patch number)');
  process.exit(1);
}

const tag = `hotpatch-v${version}`;

function run(cmd) {
  console.log('>', cmd);
  execSync(cmd, { stdio: 'inherit' });
}

try {
  run('git diff --quiet && git diff --cached --quiet');
} catch {
  console.error('\nCommit or stash your changes before shipping a hot patch.');
  process.exit(1);
}

try {
  execSync(`git rev-parse ${tag}`, { stdio: 'ignore' });
  console.error(`Tag ${tag} already exists. Bump the version or delete the tag locally.`);
  process.exit(1);
} catch {
  /* tag does not exist — good */
}

console.log(`\nShipping AdKerala hot patch ${tag}…\n`);
run(`git tag ${tag}`);
run(`git push origin ${tag}`);

console.log(`
Done.

Next:
  1. Open GitHub → Actions → watch the "Hotpatch" workflow (~1-2 min, no Windows build)
  2. Buses on a version that already supports hot patches pick it up on their next 5s
     cloud sync tick and apply it live — no restart, no install, works mid-route.

Buses on an older app version that predates this feature simply never poll for it —
they'll get the equivalent fix whenever it's folded into their next full release.
`);
