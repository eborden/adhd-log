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
  keys the CocoaPods spec/artifact cache (both native compiles are cached via ccache instead —
  see [Caching](#caching)).
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

Measured on `main` (`Assemble release APK` step, real CI runs): cold (empty ccache) **10m56s**
→ warm (ccache populated by the previous run) **5m20s**, with ccache reporting 192/192 hits.

### Android — Gradle build cache (the layer above ccache)

ccache only covers the native C/C++ compile. `--build-cache` on the `gradlew` invocation turns
on Gradle's own task-output cache — Kotlin/Java compilation, resource merging, dexing, the
Expo Gradle plugins' own jar build, and other cacheable tasks that ccache doesn't reach. Like
ccache, it's keyed by task **input content hashes**, not file mtimes, so it's immune to the
same `npm ci` timestamp churn that broke the old `android/`-tree cache. No separate cache
step is needed: [`gradle/actions/setup-gradle@v5`](https://github.com/gradle/actions)'s
default "enhanced" caching already persists `~/.gradle/caches/build-cache-1` (the local build
cache) across runs, alongside the dependency/wrapper caches it was already saving.

This was previously left off deliberately — profiling at the time found the two dominant
costs were the Metro bundle (not a Gradle task) and the cold CMake compile (not a cacheable
Gradle task output), so enabling it looked like pure noise. Once ccache took the CMake compile
off the table, the next-largest cost turned out to be exactly the layer `--build-cache` caches.

### iOS — ccache, for the same reason as Android

**Correction to an earlier version of this doc**, which claimed iOS's fingerprint-gated
`ios/`-tree cache (Pods + DerivedData) didn't hit the Android mtime problem, on the theory
that `xcodebuild`'s DerivedData reuse is keyed on its own hashes rather than raw source
mtimes. A CI log check disproved that: on a run where `Restore native cache` reported a hit
and `Prebuild (iOS)` was correctly skipped, `Build for iOS Simulator` still recompiled **every
single Pod from source** (~350 `CompileC`/`SwiftCompile` invocations across all ~25
Expo/RN modules) — a reported cache hit bought nothing.

The likely cause is the same shape as Android's bug: RN/Expo native modules are consumed as
CocoaPods `:path` pods pointing at `node_modules/`, so the actual `.mm`/`.cpp` files Xcode
compiles live in `node_modules/` rather than inside the cached `ios/` tree. `npm ci` runs
_before_ `Restore native cache` in this job — same ordering as Android had — and restamps
`node_modules` with fresh mtimes right before the (mtime-consistent, but now stale-relative-
to-source) DerivedData gets restored, so Xcode's incremental build sees every input as
"changed" and recompiles.

The fix mirrors Android exactly: [`hendrikmuhs/ccache-action`](https://github.com/hendrikmuhs/ccache-action)
(macOS-supported) plus `USE_CCACHE=1`. Unlike Android, this needs **no custom init script or
config plugin** — RN's own `react_native_pods.rb` already reads
`ccache_enabled: ENV['USE_CCACHE'] == '1'` and points `CC`/`CXX`/`LD`/`LDPLUSPLUS` at
ccache-wrapping scripts it ships (`scripts/xcode/ccache-clang.sh`) during `pod install`, which
runs inside `expo prebuild`. `Prebuild (iOS)` now runs unconditionally (previously gated on
the tree-cache hit) so that wiring is always freshly baked in, matching Android's "drift-free
by construction" reasoning; the old `ios/`-tree cache is removed since it's redundant once
prebuild always runs `--clean` anyway, and wasn't earning its keep regardless (see above).
The CocoaPods spec/artifact cache (`~/Library/Caches/CocoaPods`) is unrelated to this and
stays — it isn't compiled output, so it doesn't have the mtime problem.

> **A second gotcha, found on the first real run**: `USE_CCACHE=1`/`CCACHE_*` set as plain
> shell `env:` on the `xcodebuild` step never reach the actual compiler. `xcodebuild` doesn't
> forward the calling shell's environment into each compiler subprocess — only genuine Xcode
> build settings (confirmed from that run's log: `CC`/`CCACHE_BINARY`, which `pod install`
> wrote into the project as build settings, showed up in the per-file compile environment;
> plain env vars did not, and ccache reported **zero** cacheable calls despite ~350 real
> compiles happening — a wasted cold build, not a cache hit). Worse, RN's `ccache-clang.sh`
> wrapper unconditionally points `CCACHE_CONFIGPATH` at its own bundled conf (which has no
> `cache_dir`) unless the caller already set it — silently discarding the persistent
> `cache_dir` `hendrikmuhs/ccache-action` configures, and sending every compile to ccache's
> untracked default directory instead. The fix: generate one ccache config file with every
> setting ccache needs (`cache_dir` read back from `ccache --get-config=cache_dir`,
> `compiler_check`, `base_dir`, `hash_dir`, plus RN's recommended `sloppiness`), and pass its
> path as the `CCACHE_CONFIGPATH` **build setting** on the `xcodebuild` command line — the
> same mechanism `CODE_SIGNING_ALLOWED=NO` already uses on that line — so it actually reaches
> the compiler.
