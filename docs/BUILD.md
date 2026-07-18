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

## Build + install

```bash
# 1. Generate the native android/ project from app.json + config plugins.
#    (android/ is gitignored and fully regenerated; safe to delete anytime.)
CI=1 npx expo prebuild --platform android

# 2. Build the signed release APK (first run is slow: Gradle + deps).
set -a; . credentials/signing.properties; set +a
export ANDROID_HOME=~/Library/Android/sdk ANDROID_SDK_ROOT=~/Library/Android/sdk
( cd android && ./gradlew :app:assembleRelease \
    -PADHDLOG_KEYSTORE_FILE="$ADHDLOG_KEYSTORE_FILE" \
    -PADHDLOG_KEYSTORE_PASSWORD="$ADHDLOG_KEYSTORE_PASSWORD" \
    -PADHDLOG_KEY_ALIAS="$ADHDLOG_KEY_ALIAS" \
    -PADHDLOG_KEY_PASSWORD="$ADHDLOG_KEY_PASSWORD" )

# 3. Install to a USB-connected device (or use -r to replace in place).
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

The APK lands at `android/app/build/outputs/apk/release/app-release.apk`.

## How signing is wired

`expo prebuild` regenerates `android/` each time, so we do **not** keep the password in
that tree. `android/app/build.gradle` declares a `release` signing config that only
activates when the `ADHDLOG_*` Gradle properties are present (passed as `-P` flags in
step 2, sourced from `credentials/signing.properties`); without them it falls back to the
debug key. The secret therefore lives only in the gitignored `credentials/` dir.

> Note: the `build.gradle` signing edit is applied to the generated `android/` tree. If
> you run `expo prebuild --clean` it is regenerated and the edit is lost — re-apply the
> `release` signingConfig block (see git history / this repo's build commit) or, for a
> more permanent setup, move it into an Expo config plugin.

## Updating the app later

Re-run the three steps. As long as the same `credentials/` keystore is used, the new APK
installs over the old one and keeps all on-device data.

## Why not EAS / cloud build?

This app is deliberately local-only and the machine sits behind a corporate VPN +
endpoint security that has blocked tunnel/cloud tooling. A local build keeps the source
and signing key on the machine and needs no account or network round-trip to Expo.
