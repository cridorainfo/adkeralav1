#!/usr/bin/env node
/**
 * Ship a new PC + driver release in one step.
 *
 * Usage:
 *   npm run ship -- 1.2.0
 *
 * This creates git tag v1.2.0 and pushes it. GitHub Actions then:
 *   - builds the PC installer + driver APK
 *   - publishes GitHub Release
 *   - registers download URLs on the cloud admin
 *   - redeploys cloud to Railway (if RAILWAY_TOKEN is set)
 */

import { execSync } from 'child_process';

const version = process.argv[2]?.trim().replace(/^v/i, '');

if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error('Usage: npm run ship -- X.Y.Z');
  console.error('Example: npm run ship -- 1.2.0');
  process.exit(1);
}

const tag = `v${version}`;

function run(cmd) {
  console.log('>', cmd);
  execSync(cmd, { stdio: 'inherit' });
}

try {
  run('git diff --quiet && git diff --cached --quiet');
} catch {
  console.error('\nCommit or stash your changes before shipping a release.');
  process.exit(1);
}

try {
  execSync(`git rev-parse ${tag}`, { stdio: 'ignore' });
  console.error(`Tag ${tag} already exists. Bump the version or delete the tag locally.`);
  process.exit(1);
} catch {
  /* tag does not exist — good */
}

console.log(`\nShipping AdKerala ${tag}…\n`);
run(`git tag ${tag}`);
run(`git push origin ${tag}`);

console.log(`
Done.

Next:
  1. Open GitHub → Actions → watch the "Release" workflow (~10–20 min)
  2. Open cloud admin → Releases → confirm latest PC v${version}
  3. Click "Push update to all buses now" (optional — buses also auto-update within ~15 min)

Field staff do not need to do anything on buses that already have the app installed.
`);
