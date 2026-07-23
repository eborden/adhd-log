// Fingerprint-gated standalone release build + install.
//
// The slow part of an Android build is the native compile (RN/Hermes/new-arch
// codegen). It is a pure function of the *native* inputs — native deps, app.json,
// config plugins, Expo/RN versions, assets baked into the binary — NOT of your JS/TS.
// So this script hashes exactly those inputs with @expo/fingerprint and only does the
// destructive `expo prebuild --clean` (which wipes android/ and forces a full native
// rebuild) when that hash changes. Otherwise it skips prebuild entirely and lets Gradle
// reuse the preserved native outputs (android/app/.cxx + build/), so only the JS bundle
// re-runs.
//
// This deliberately never uses `expo prebuild --no-clean`: --no-clean applies changes on
// top of an existing tree and can accumulate stale files (a "harmful artifact"). The
// clean-or-skip gate is drift-free by construction — clean when inputs changed, skip when
// they are byte-for-byte identical. The fingerprint errs toward MORE cleaning, never less:
// worst case is an unnecessary full rebuild, never a stale reuse.
//
// Usage:
//   node scripts/build-apk.mjs            # gate decides clean-vs-skip, build, install
//   node scripts/build-apk.mjs --clean    # force a full clean rebuild
//   node scripts/build-apk.mjs --dry-run  # print the decision + commands, run nothing
//
// See docs/BUILD.md for the measured numbers and the dev-loop alternative.

import { createFingerprintAsync } from '@expo/fingerprint';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const DRY = process.argv.includes('--dry-run');
const FORCE_CLEAN = process.argv.includes('--clean');

// The regenerated native trees are excluded — we hash the inputs that DETERMINE them.
const IGNORE_PATHS = ['android/**', 'ios/**'];
// Durable across the android/ wipe (android/ itself is gitignored + regenerated).
const FP_FILE = path.join(ROOT, '.native-fingerprint');
const APK = 'android/app/build/outputs/apk/release/app-release.apk';
const SIGNING_FILE = path.join(ROOT, 'credentials/signing.properties');

const maskSecrets = (s) => s.replace(/(-P\w*PASSWORD=)\S+/g, '$1********');

function run(cmd, args, opts = {}) {
  console.log('   $ ' + maskSecrets([cmd, ...args].join(' ')));
  if (DRY) return;
  execFileSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts });
}

// Parse credentials/signing.properties (KEY=VALUE lines) into Gradle -P flags. Absent →
// the build.gradle signing config falls back to the debug key (see withReleaseSigning).
function loadSigningFlags() {
  if (!fs.existsSync(SIGNING_FILE)) return null;
  const props = {};
  for (const line of fs.readFileSync(SIGNING_FILE, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) props[m[1]] = m[2].trim();
  }
  const keys = [
    'ADHDLOG_KEYSTORE_FILE',
    'ADHDLOG_KEYSTORE_PASSWORD',
    'ADHDLOG_KEY_ALIAS',
    'ADHDLOG_KEY_PASSWORD',
  ];
  return keys.filter((k) => props[k] !== undefined).map((k) => `-P${k}=${props[k]}`);
}

function resolveAndroidEnv() {
  const env = { ...process.env };
  if (!env.ANDROID_HOME && !env.ANDROID_SDK_ROOT) {
    const sdk = path.join(os.homedir(), 'Library/Android/sdk');
    env.ANDROID_HOME = sdk;
    env.ANDROID_SDK_ROOT = sdk;
  }
  return env;
}

// If ccache is installed, route the native compile through it (content-addressed, so it
// survives a clean prebuild) via gradle/ccache.init.gradle. Absent → return null and the
// build runs unchanged. Mirrors what CI does with hendrikmuhs/ccache-action. See docs/CI.md.
const CCACHE_INIT = path.join(ROOT, 'gradle/ccache.init.gradle');
function resolveCcache(env) {
  try {
    execFileSync('ccache', ['--version'], { stdio: 'ignore' });
  } catch {
    return null; // not installed / not on PATH
  }
  return {
    initArgs: ['--init-script', CCACHE_INIT],
    env: { ...env, ADHDLOG_CCACHE: 'ccache', CCACHE_COMPILERCHECK: 'content' },
  };
}

const started = Date.now();

const { hash } = await createFingerprintAsync(ROOT, { ignorePaths: IGNORE_PATHS });
const stored = fs.existsSync(FP_FILE) ? fs.readFileSync(FP_FILE, 'utf8').trim() : null;
const androidExists = fs.existsSync(path.join(ROOT, 'android'));
const needClean = FORCE_CLEAN || !androidExists || stored !== hash;

console.log('native fingerprint : ' + hash);
console.log('stored fingerprint : ' + (stored ?? '(none)'));
console.log('android/ present   : ' + androidExists);
if (FORCE_CLEAN) console.log('decision           : --clean forced');
else if (!androidExists) console.log('decision           : no android/ yet → clean prebuild');
else if (stored === null)
  console.log('decision           : no baseline fingerprint → clean prebuild (establishes it)');
else if (stored !== hash)
  console.log('decision           : native inputs CHANGED → clean prebuild + full rebuild');
else console.log('decision           : native unchanged → SKIP prebuild, incremental Gradle');

const signingFlags = loadSigningFlags();
if (!signingFlags) {
  console.log(
    '\nWARNING: credentials/signing.properties not found — release falls back to the DEBUG key.',
  );
}

const env = resolveAndroidEnv();
const ccache = resolveCcache(env);
console.log(
  'ccache             : ' +
    (ccache ? 'on (content-addressed compiler cache)' : 'not installed — skipping'),
);

console.log('\nsteps:');
if (needClean) {
  run('npx', ['expo', 'prebuild', '--platform', 'android', '--clean'], { env });
}
run('./gradlew', [':app:assembleRelease', ...(ccache?.initArgs ?? []), ...(signingFlags ?? [])], {
  cwd: path.join(ROOT, 'android'),
  env: ccache?.env ?? env,
});

// Record the fingerprint only after a clean build actually reproduced these inputs, so a
// failed build (execFileSync throws above) never poisons the baseline.
if (needClean && !DRY) fs.writeFileSync(FP_FILE, hash + '\n');

run('adb', ['install', '-r', APK], { env });

if (!DRY) console.log('\nDone in ' + Math.round((Date.now() - started) / 1000) + 's → ' + APK);
