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

### iOS — fingerprint-gated native-tree cache (does not speed up the compile)

iOS caches the whole `ios/` tree (Pods + DerivedData) keyed by the `@expo/fingerprint` hash:
on a hit, `expo prebuild`/`pod install` is skipped, saving that step's time; on a miss, a
clean prebuild + full compile runs and populates the cache. The key folds in the resolved
Node version (`ios-native-…-node<version>-<fp>`) because CocoaPods bakes an **absolute path**
to the Node binary into the generated project (`.xcode.env.local`), so a tree built under a
different Node version would point at a binary that no longer exists on the runner — bumping
`.nvmrc` forces a fresh prebuild.

**This does not make `xcodebuild` itself faster.** A CI log check (comparing a run with a
reported cache hit against its actual `CompileC`/`SwiftCompile` count) showed every single Pod
recompiling from source regardless — likely because RN/Expo native modules are consumed as
CocoaPods `:path` pods pointing straight at `node_modules/`, and `npm ci` (which runs before
the cache restore) restamps those files with fresh mtimes every job, so Xcode's incremental
build treats them as changed no matter what DerivedData was restored. The tree cache is kept
anyway because skipping `pod install` on a hit is a real, if modest, saving — the compile
itself is not.

> **ccache was tried here and reverted** (see git history around 2026-07-23). Two mechanisms
> were tested: RN's documented `CC`/`CXX`-substitution integration (`USE_CCACHE=1` via
> `react_native_pods.rb`) never actually invoked ccache at all on this Xcode version — Xcode's
> build log displays that command as text, but doesn't spawn it, confirmed with a throwaway
> wrapper script that provably never ran. The newer `C_COMPILER_LAUNCHER`/
> `CXX_COMPILER_LAUNCHER` mechanism (documented in a [ccache maintainer discussion](https://github.com/ccache/ccache/discussions/1670)
> and tracked as an [open react-native issue](https://github.com/react/react-native/issues/55381))
> _does_ get invoked, but every call comes back `Result: could_not_use_modules` in ccache's own
> decision log — Clang's module-validation-session mechanism (`-fbuild-session-file` /
> `-fmodules-validate-once-per-build-session`), which modern Xcode bakes in by default and
> doesn't fully turn off via `CLANG_ENABLE_EXPLICIT_MODULES=NO` alone, defeats ccache's module
> handling every time. Making it work would mean disabling Clang modules entirely
> (`CLANG_ENABLE_MODULES=NO`), which risks breaking compilation against modular system
> frameworks (Foundation, UIKit, …) — a disproportionate risk for a CI speed optimization on a
> personal project. If a future ccache/Xcode release resolves the module-cache interaction,
> this is worth revisiting; until then, the added complexity wasn't earning its keep.
