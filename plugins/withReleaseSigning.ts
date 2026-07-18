import { withAppBuildGradle, type ConfigPlugin } from '@expo/config-plugins';

/**
 * Injects the release signing config into the generated `android/app/build.gradle`.
 *
 * `expo prebuild` regenerates (and clears) the `android/` tree, so any hand edit to
 * build.gradle is lost on the next prebuild — and since `android/` is gitignored, it
 * lives nowhere durable. This plugin re-applies the edit deterministically on every
 * prebuild instead.
 *
 * The release signing only activates when the `ADHDLOG_*` Gradle properties are passed
 * in (sourced from the gitignored `credentials/signing.properties`); otherwise the build
 * falls back to the debug key. The keystore password therefore never enters this tree.
 * See docs/BUILD.md.
 */

// The debug signingConfig block from the stock RN/Expo template — we append the
// release block immediately after it, inside `signingConfigs { … }`.
const SIGNING_CONFIGS_ANCHOR = `        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }`;

const RELEASE_SIGNING_CONFIG = `
        // Release signing activates only when the ADHDLOG_* Gradle properties are
        // passed in (sourced from the gitignored credentials/signing.properties);
        // otherwise the build falls back to the debug key. See docs/BUILD.md.
        release {
            if (project.hasProperty('ADHDLOG_KEYSTORE_FILE')) {
                storeFile file(ADHDLOG_KEYSTORE_FILE)
                storePassword ADHDLOG_KEYSTORE_PASSWORD
                keyAlias ADHDLOG_KEY_ALIAS
                keyPassword ADHDLOG_KEY_PASSWORD
            }
        }`;

// The release buildType's stock signingConfig line, with its surrounding comment, so
// the anchor is unambiguous (the debug buildType has an identical bare line).
const RELEASE_BUILDTYPE_ANCHOR = `        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`;

const RELEASE_BUILDTYPE_REPLACEMENT = `        release {
            signingConfig project.hasProperty('ADHDLOG_KEYSTORE_FILE') ? signingConfigs.release : signingConfigs.debug`;

const SENTINEL = 'ADHDLOG_KEYSTORE_FILE';

const withReleaseSigning: ConfigPlugin = (config) =>
  withAppBuildGradle(config, (gradleConfig) => {
    const { modResults } = gradleConfig;
    if (modResults.language !== 'groovy') {
      throw new Error(
        `withReleaseSigning: expected a Groovy build.gradle, got "${modResults.language}".`,
      );
    }

    // Idempotent: a prior run in this same prebuild already applied it.
    if (modResults.contents.includes(SENTINEL)) {
      return gradleConfig;
    }

    // Fail loudly if the template shifted out from under our anchors — a silent
    // no-op here would ship a debug-signed "release" APK.
    if (!modResults.contents.includes(SIGNING_CONFIGS_ANCHOR)) {
      throw new Error(
        'withReleaseSigning: could not find the debug signingConfig block to anchor to; ' +
          'the RN/Expo template may have changed. Update plugins/withReleaseSigning.ts.',
      );
    }
    if (!modResults.contents.includes(RELEASE_BUILDTYPE_ANCHOR)) {
      throw new Error(
        'withReleaseSigning: could not find the release buildType signingConfig line; ' +
          'the RN/Expo template may have changed. Update plugins/withReleaseSigning.ts.',
      );
    }

    modResults.contents = modResults.contents
      .replace(SIGNING_CONFIGS_ANCHOR, SIGNING_CONFIGS_ANCHOR + RELEASE_SIGNING_CONFIG)
      .replace(RELEASE_BUILDTYPE_ANCHOR, RELEASE_BUILDTYPE_REPLACEMENT);

    return gradleConfig;
  });

export default withReleaseSigning;
