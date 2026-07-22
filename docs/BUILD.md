# Building a standalone Android app (local)

How to produce a signed, installable release APK on your own machine — no Expo
account, no cloud, nothing uploaded. This is how the app gets onto a physical phone
"for real" (a standalone icon that runs without the Metro dev server, and where
scheduled reminders actually fire — unlike Expo Go on Android).

## Prerequisites (one-time)

- **JDK 17** — `java -version` should report 17.
- **Android SDK** at `~/Library/Android/sdk` (installed with Android Studio). The build
  uses `platforms/android-35` and build-tools; Gradle auto-downloads any missing pieces
  since the SDK licenses are already accepted.
- A **release keystore** at `credentials/adhd-log-release.jks` with its passwords in
  `credentials/signing.properties`. Both are **gitignored** — this directory is the
  app's signing identity.
  - ⚠️ **Back up `credentials/`** somewhere safe. If you lose the keystore you can no
    longer ship updates that install over an existing install — you'd have to uninstall
    first and lose local data.
  - To regenerate from scratch (new identity):
    ```
    keytool -genkeypair -v -keystore credentials/adhd-log-release.jks \
      -alias adhd-log -keyalg RSA -keysize 2048 -validity 10000 \
      -storepass <PASS> -keypass <PASS> \
      -dname "CN=ADHD Log, OU=Personal, O=ADHD Log, C=US"
    ```
    then write the matching `credentials/signing.properties` (see keys below).

`credentials/signing.properties` keys:

```
ADHDLOG_KEYSTORE_FILE=/abs/path/to/credentials/adhd-log-release.jks
ADHDLOG_KEYSTORE_PASSWORD=…
ADHDLOG_KEY_ALIAS=adhd-log
ADHDLOG_KEY_PASSWORD=…
```

## Two build paths — pick by intent

There is a hard floor on how fast a **standalone release** build can be, so there are two
distinct workflows. Measured on a Pixel 7 / M-series Mac:

| Build                         | Time     | Notes                                          |
| ----------------------------- | -------- | ---------------------------------------------- |
| Release, cold (first ever)    | ~9m30s   | full native C++/Hermes/codegen compile         |
| Release, native unchanged     | **~50s** | native skipped; ~46s is the JS bundle + Hermes |
| Dev loop (Metro fast refresh) | **<1s**  | JS served live; no rebuild, no reinstall       |

The ~46s in a warm release build is `:app:createBundleReleaseJsAndAssets` — Metro bundling
your JS graph and compiling it to Hermes bytecode. It runs on **every** release build and is
not incremental; caching its output across code changes would ship a stale bundle, so it is
the irreducible cost of a self-contained APK. If you want sub-second iteration, use the dev
loop and reserve the release build for putting a "real" install on the phone.

### Fast iteration — the dev loop (seconds)

```bash
npm run android   # ONE-TIME (or when native inputs change): builds + installs a debug
                  # dev build and starts Metro. Same native compile cost as a release.
# then, day to day:
npm start         # start Metro; edit any .ts/.tsx → save → fast-refresh on device in <1s
adb reverse tcp:8081 tcp:8081   # once per USB session, if not on the same Wi-Fi
```

A debug build loads its JS from Metro, so it is **not** an unplug-and-go artifact — with no
Metro reachable it can't load JS. Reminders still fire and it has its own launcher icon.

### Standalone release — `npm run apk` (fingerprint-gated)

```bash
npm run apk         # gate decides clean-vs-skip, builds the signed APK, installs via adb
npm run apk:clean   # force a full clean rebuild (use if something looks stale)
```

`scripts/build-apk.mjs` hashes the **native** inputs (native deps, `app.json`, `plugins/`,
Expo/RN versions, baked-in `assets/`) with `@expo/fingerprint`, excluding the regenerated
`android/`/`ios/` trees, and stores the hash in `.native-fingerprint` (gitignored, per-machine):

- **hash unchanged** → skip `expo prebuild` entirely, so `android/app/.cxx` + `build/`
  survive and Gradle reuses them (the ~50s path).
- **hash changed / no baseline / no `android/`** → `expo prebuild --clean` + full rebuild,
  then record the new hash.

This is drift-free by construction: it never uses `expo prebuild --no-clean` (which applies
changes on top of an existing tree and can leave stale files behind). Clean when inputs
changed, skip when they are byte-for-byte identical — and the fingerprint errs toward _more_
cleaning, never less, so a mismatch can only cost an unnecessary rebuild, never a stale APK.

> Not used, deliberately: Gradle's build cache (`org.gradle.caching`). Profiling showed the
> two costs are the Metro bundle (not a Gradle task) and the cold CMake native compile (a
> `.cxx` external-native build, not stored in Gradle's build cache). Neither is helped by it,
> so enabling it would be noise. The daemon + `org.gradle.parallel=true` (already in the
> generated `gradle.properties`) are the only Gradle knobs that matter here.

The APK lands at `android/app/build/outputs/apk/release/app-release.apk`. The equivalent
manual commands (if you're not using the script):

```bash
# only when native inputs changed (npm run apk does this automatically):
npx expo prebuild --platform android --clean
set -a; . credentials/signing.properties; set +a
export ANDROID_HOME=~/Library/Android/sdk ANDROID_SDK_ROOT=~/Library/Android/sdk
( cd android && ./gradlew :app:assembleRelease \
    -PADHDLOG_KEYSTORE_FILE="$ADHDLOG_KEYSTORE_FILE" \
    -PADHDLOG_KEYSTORE_PASSWORD="$ADHDLOG_KEYSTORE_PASSWORD" \
    -PADHDLOG_KEY_ALIAS="$ADHDLOG_KEY_ALIAS" \
    -PADHDLOG_KEY_PASSWORD="$ADHDLOG_KEY_PASSWORD" )
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

## How signing is wired

`expo prebuild` regenerates (and clears) the whole `android/` tree, so we do **not** keep
the password — or any hand edit — in that tree. Instead, the config plugin
[`plugins/withReleaseSigning.ts`](../plugins/withReleaseSigning.ts) (registered in
`app.json` under `plugins`) re-injects a `release` signing config into
`android/app/build.gradle` on **every** prebuild. That config only activates when the
`ADHDLOG_*` Gradle properties are present (passed as `-P` flags by the build, sourced from
`credentials/signing.properties`); without them it falls back to the debug key. The secret
therefore lives only in the gitignored `credentials/` dir.

Because the plugin runs automatically, there is nothing to re-apply by hand after a
prebuild (`--clean` or not) — regenerate freely.

> Note: the plugin anchors on the stock RN/Expo `build.gradle` template text. If a future
> Expo/RN upgrade changes that template, the plugin **throws during prebuild** rather than
> silently shipping a debug-signed APK — update the anchor strings in
> `plugins/withReleaseSigning.ts` when that happens.

## Updating the app later

Re-run `npm run apk`. As long as the same `credentials/` keystore is used, the new APK
installs over the old one and keeps all on-device data. Most updates are JS-only, so the
gate skips prebuild and you get the ~50s path; a native-input change triggers one clean
rebuild automatically.

## Why not EAS / cloud build?

This app is deliberately local-only and the machine sits behind a corporate VPN +
endpoint security that has blocked tunnel/cloud tooling. A local build keeps the source
and signing key on the machine and needs no account or network round-trip to Expo.

For building on GitHub Actions (still no EAS — GitHub-hosted runners run the same
prebuild + Gradle/xcodebuild sequence), see [`CI.md`](CI.md).
