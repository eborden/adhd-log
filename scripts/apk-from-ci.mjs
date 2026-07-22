// Wait for a GitHub Actions CI run to finish, then download and install the release APK
// it built (see docs/CI.md). Companion to build-apk.mjs, which builds locally instead.
//
// Usage:
//   node scripts/apk-from-ci.mjs              # latest run on main
//   node scripts/apk-from-ci.mjs <run-id>      # a specific run
//   node scripts/apk-from-ci.mjs --dry-run [run-id]

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const DRY = process.argv.includes('--dry-run');
const runIdArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const ARTIFACT_NAME = 'adhd-log-release-apk';
const APK_FILE = 'app-release.apk';

// This machine's shell exports a stale GH_TOKEN that shadows the valid `gh auth login`
// keyring session — strip it (and GITHUB_TOKEN) so `gh` falls back to the keyring account.
function ghEnv() {
  const env = { ...process.env };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  return env;
}

function gh(args) {
  return execFileSync('gh', args, { cwd: ROOT, env: ghEnv(), encoding: 'utf8' });
}

function run(cmd, args, opts = {}) {
  console.log('   $ ' + [cmd, ...args].join(' '));
  if (DRY) return;
  execFileSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts });
}

function resolveRunId() {
  if (runIdArg) return runIdArg;
  const [latest] = JSON.parse(
    gh(['run', 'list', '--branch', 'main', '--limit', '1', '--json', 'databaseId']),
  );
  if (!latest) throw new Error('no CI runs found on main');
  return String(latest.databaseId);
}

const runId = resolveRunId();
console.log('run id : ' + runId);

console.log('\nsteps:');
run('gh', ['run', 'watch', runId, '--exit-status'], { env: ghEnv() });

const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'adhd-log-apk-'));
run('gh', ['run', 'download', runId, '-n', ARTIFACT_NAME, '-D', dest], { env: ghEnv() });

const apkPath = path.join(dest, APK_FILE);
run('adb', ['install', '-r', apkPath]);

if (!DRY) console.log('\nInstalled ' + apkPath + ' from CI run ' + runId);
