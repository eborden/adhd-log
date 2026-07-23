# CI/CD on GitHub Actions

GitHub builds the app on its own runners — nothing runs on, or is uploaded from, your
machine, and no Expo/EAS account is involved (consistent with the local-only stance in
[`BUILD.md`](BUILD.md)). Workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

## What runs when

| Trigger        | `check` | `android` | `ios`     |
| -------------- | ------- | --------- | --------- |
| Pull request   | ✅ runs | ⏭ skipped | ⏭ skipped |
| Push to `main` | ✅ runs | ✅ runs   | ✅ runs   |

- **`check`** (ubuntu) — the same gate as local `npm run check` (typecheck, lint,
  format:check, test + coverage, type-coverage) plus computing the native fingerprint that
  keys the iOS native-tree cache (Android now uses ccache instead — see [Caching](#caching)).
- **`android`** (ubuntu) — signed release APK. Needs `check` green.
- **`ios`** (macOS) — **unsigned iOS Simulator** `.app`. Needs `check` green.

Both build jobs are gated behind `check` and only run on pushes to `main`.

## Artifacts

Open the workflow run → **Artifacts**:

- **`adhd-log-release-apk`** — `app-release.apk`. Sideload with `adb install -r app-release.apk`
  (installs over an existing install as long as it was signed with the same keystore).
- **`adhd-log-ios-sim`** — `adhd-log-sim.app.zip`. Unzip and drag the `.app` onto a booted iOS
  Simulator, or `xcrun simctl install booted adhd-log-sim.app`.
  - ⚠️ This is a **Simulator build only** — it does not run on a physical iPhone. A
    device-installable / TestFlight `.ipa` requires an Apple Developer account plus a signing
    certificate and provisioning profile (not configured here).

### Installing a CI-built APK locally

```bash
npm run apk:ci             # waits for the latest run on main, then adb-installs its APK
npm run apk:ci -- <run-id> # target a specific run instead of the latest
```

`scripts/apk-from-ci.mjs` wraps `gh run watch` + `gh run download` + `adb install -r` — the
same steps as opening the run's Artifacts tab and sideloading by hand, just scripted.

## Required secrets (Android signing)

The keystore and its passwords are gitignored (`credentials/`), so CI reconstructs them from
repository secrets — **Settings → Secrets and variables → Actions**. Without them the release
would fall back to the debug key (see `plugins/withReleaseSigning.ts`).

| Secret                      | Value                                                             |
| --------------------------- | ----------------------------------------------------------------- |
| `ANDROID_KEYSTORE_BASE64`   | base64 of `credentials/adhd-log-release.jks`                      |
| `ANDROID_KEYSTORE_PASSWORD` | `ADHDLOG_KEYSTORE_PASSWORD` from `credentials/signing.properties` |
| `ANDROID_KEY_ALIAS`         | `ADHDLOG_KEY_ALIAS` (e.g. `adhd-log`)                             |
| `ANDROID_KEY_PASSWORD`      | `ADHDLOG_KEY_PASSWORD`                                            |

Set them with the `gh` CLI:

```bash
gh secret set ANDROID_KEYSTORE_BASE64 < <(base64 -i credentials/adhd-log-release.jks)
gh secret set ANDROID_KEYSTORE_PASSWORD
gh secret set ANDROID_KEY_ALIAS
gh secret set ANDROID_KEY_PASSWORD
```

iOS needs no secrets — the Simulator build is unsigned.

## Caching

Beyond npm, Gradle dependencies, and the CocoaPods spec cache:

### Android — ccache (compiler cache), not a native-tree cache

The native C++ compile (RN/Hermes/folly/turbo-modules, ×4 ABIs) is the tall pole in the
Android build. It is cached with [`hendrikmuhs/ccache-action`](https://github.com/hendrikmuhs/ccache-action),
a **content-addressed** compiler cache: ccache hashes each translation unit's preprocessed
source + flags and returns the cached object on a match, so a cache hit is independent of
file timestamps. The launcher wiring lives in [`gradle/ccache.init.gradle`](../gradle/ccache.init.gradle)
(`CMAKE_C/CXX_COMPILER_LAUNCHER=ccache`), passed to Gradle via `--init-script` so it reaches
every native module without editing the regenerated `android/` tree. `expo prebuild --clean`
runs unconditionally now (a few seconds); the compile it triggers lands as ccache hits.

> **Why not cache the `android/` build tree** (the previous approach)? That cache preserved
> compiled outputs keyed by `@expo/fingerprint` and relied on file **mtimes** surviving the
> cache round-trip. But `npm ci` runs on every job and restamps `node_modules` _after_ the
> tree is restored, so ninja saw "sources newer than objects" and recompiled the entire
> native layer regardless of the cache hit — the advertised "~50s warm path" never
> materialised in CI (only locally, where `node_modules` isn't reinstalled per build).
> ccache sidesteps the whole mtime problem: it keys on source _content_, and
> `CCACHE_COMPILERCHECK=content` + `CCACHE_BASEDIR`/`CCACHE_NOHASHDIR` keep hits stable even
> as the NDK clang's absolute path and mtime vary across runners. The Metro JS bundle is
> still never cached and runs every build, so it can't ship stale JS.

### iOS — fingerprint-gated native-tree cache

iOS still caches the whole `ios/` tree (Pods + DerivedData) keyed by the `@expo/fingerprint`
hash: on a hit, `expo prebuild` is skipped and `xcodebuild` reuses DerivedData; on a miss, a
clean prebuild + full compile runs and populates the cache. The key folds in the resolved
Node version (`ios-native-…-node<version>-<fp>`) because CocoaPods bakes an **absolute path**
to the Node binary into the generated project (`.xcode.env.local`), so a tree built under a
different Node version would point at a binary that no longer exists on the runner — bumping
`.nvmrc` forces a fresh prebuild. (iOS doesn't hit the Android mtime problem the same way:
`xcodebuild`'s DerivedData reuse is keyed on its own hashes, not raw source mtimes. Migrating
iOS to ccache too is a possible follow-up.)
