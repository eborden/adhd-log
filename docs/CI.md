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
  format:check, test + coverage, type-coverage) plus computing the native fingerprint used as
  the build caches' key.
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

Beyond npm, Gradle dependencies, and the CocoaPods spec cache, the build jobs port
`build-apk.mjs`'s fingerprint gate to CI: the `@expo/fingerprint` hash of the native inputs
keys a cache of the whole `android/` / `ios/` tree. On a hit, `expo prebuild` is skipped and
the compiled native output is reused (the ~50s warm path); on a miss, a clean prebuild + full
compile runs and then populates the cache. A matching fingerprint means the native inputs are
byte-identical, so the cache is valid by the same argument the local gate relies on — a
mismatch only ever costs a rebuild, never a stale artifact. The Metro JS bundle is never
cached and runs every build, so it can't ship stale JS.

The cache key also folds in the resolved Node version (`android-native-…-node<version>-<fp>`,
same for `ios-native-…`). `expo prebuild`/CocoaPods bakes an **absolute path** to the Node
binary into the generated project (`.xcode.env.local` on iOS in particular), so restoring a
tree built under a different Node version would point at a binary that no longer exists on
the runner. Bumping `.nvmrc` therefore forces a fresh prebuild on both platforms rather than
silently reusing a native tree wired to a stale Node path.
