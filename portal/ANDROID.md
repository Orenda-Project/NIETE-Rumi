# NIETE Android app — build & test

The portal SPA wrapped in Capacitor as an Android app. Same React code as the
web portal; only the build and a few runtime decisions differ.

> **App identity is fixed.** `appId` is `pk.edu.niete` because this build
> replaces the existing NIETE Play Store listing, and Play identifies an app by
> package name permanently. Do not change it.

## Prerequisites

| Need | Version | Note |
|---|---|---|
| JDK | **21** | Capacitor 8's `capacitor-android` hardcodes Java 21. JDK 17 fails with `invalid source release: 21`; a JRE-only JDK 25 fails with `does not provide JAVA_COMPILER`. |
| Android SDK | platform **35**, build-tools **35.0.0**, platform-tools | |
| Node deps | `npm ci` in `portal/` | |

`.android-env.sh` (gitignored, machine-local) sets `JAVA_HOME`, `ANDROID_HOME`
and `PATH`. Create your own if it's missing:

```bash
export JAVA_HOME="$HOME/.local/jdk/jdk-21.0.12+8"   # any real JDK 21
export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
```

No-root SDK/JDK install:
```bash
# JDK 21
curl -fsSL https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse \
  | tar -xz -C ~/.local/jdk
# SDK cmdline-tools, then:
sdkmanager --sdk_root="$ANDROID_HOME" "platform-tools" "platforms;android-35" "build-tools;35.0.0"
```

## Build

The app needs an **absolute** API URL — inside the WebView the page origin is
`https://localhost`, so a relative `/api/portal` resolves to nothing. That
comes from `.env.app` (gitignored):

```
VITE_APP_TARGET=app
VITE_API_BASE_URL=https://<portal-host>/api/portal
```

```bash
cd portal
source .android-env.sh
npm run android:debug
# -> android/app/build/outputs/apk/debug/app-debug.apk
```

`android:debug` chains the three steps that must never be run out of order:
`build:app` (web assets **with** the absolute API URL) → `cap sync android` →
`assembleDebug`. Use the script rather than the individual commands.

> **Why this is a script and not three typed commands (bd-2551).** The
> `--mode app` flag is what loads `.env.app` and supplies `VITE_API_BASE_URL`.
> It used to be a hand-typed step documented here, and versionCode **1206**
> shipped to Play without it: `resolveApiBaseUrl()` threw at first render,
> React never mounted, and every launch was a white screen until a downtime
> notice went out to 80 coaches. The flag was never the problem — depending on
> a human to remember it was. `npm run build:app` cannot forget.

For a release bundle, `npm run android:release` runs the same chain into
`bundleRelease`. In practice you should not need it — **CI builds releases**
(see *Releasing* below); the script exists for local diagnosis.

The build **fails loudly** if a native build has no absolute `VITE_API_BASE_URL`
— that's deliberate, so a misconfigured app can't ship silently pointing at a
host with no server.

## Install and test

```bash
adb devices                                    # confirm the phone is attached
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb logcat | grep -iE "capacitor|chromium"     # watch for WebView errors
```

### What to check

| # | Check | Expected |
|---|---|---|
| 1 | App opens | The **portal login screen** — not the public marketing page |
| 2 | Login | Succeeds with a phone number + password set up beforehand via the WhatsApp link |
| 3 | Data loads | Dashboard, lesson plans, curriculum, training, coaching show real data |
| 4 | Session persists | ⏳ **Fix applied (bd-2402), needs a device run** — `MainActivity.onPause()` now flushes the WebView cookie store to disk so a force-close no longer drops the persistent session cookie. Confirm: log in, swipe the app away, reopen → land on the dashboard. |
| 5 | Back button | Navigates back; exits only from the dashboard root |
| 6 | WhatsApp links | Open WhatsApp / the browser, not a dead WebView |
| 7 | Stability | No crash or freeze during normal navigation |

**Status as of 2026-07-29** (Realme RMX2061, real hardware): #1, #2, #3 and #7
pass. #4 **failed** — session did not survive force-close. **Fix applied
2026-08-01 (bd-2402)**: `MainActivity.onPause()` flushes the WebView cookie store
to disk; awaiting a re-run on real hardware to close it out. #5 and #6 are not
implemented yet.

Login (#2) only works because the portal server allows the app's origin through
CORS and issues the session cookie with `SameSite=None`. If login starts failing
with "correct" credentials, check that first — the symptom is a CORS error in
`adb logcat`, not an auth error.

> First run is **not** zero-touch yet: the portal is login-gated and passwords
> are issued through a one-time WhatsApp setup link, so a fresh install lands on
> a login screen. Making that automatic is a separate, deferred decision.

## Web build is unaffected

`npm run build` (no `--mode app`) still produces the website bundle with the
relative `/api/portal` path and hostname-based portal detection. One codebase,
two targets — verified by `tests/portal/app-target.test.js`.

## Releasing

**CI builds and signs releases — not your laptop.** Tag a version and the
`Android Release` workflow builds through `build:app`, signs with the inherited
NIETE key from secrets, verifies the signature, and uploads to the Play
**internal** track:

```bash
git tag android-v1207 && git push origin android-v1207
```

Or run **Actions → Android Release → Run workflow** to choose the track, toggle
OTA, or do a `dry_run` (build + sign, no upload). Promotion from internal to
production stays a human decision in the Play Console.

`versionCode` must be **strictly higher** than the live release or Play rejects
the upload — bump it in `android/app/build.gradle` (and the floor in
`tests/portal/android-release-identity.test.js`) as part of the release commit.

Before this pipeline existed the release was a local build plus a manual
upload, and the artifact that reached users could not be reproduced afterwards.
That is how 1206 shipped broken.

### Testing a change on a device

Three builds, three jobs. All three install **side by side** on one handset —
distinct `applicationId`s — so a tester can hold prod, staging and a PR build
at once and compare them directly.

| Build | Package | Backend | Signed with | Built when |
|---|---|---|---|---|
| **Debug** | `pk.edu.niete.debug` | staging | debug key | every PR touching `portal/**` |
| **Staging** | `pk.edu.niete.staging` | staging | debug key | every push to `develop` |
| **Release** | `pk.edu.niete` | production | **NIETE release key** | `android-v*` tag |

**Debug** answers *"is this change sane?"* — download the APK from the PR's
**Checks** tab and `adb install -r` it. No local JDK or Android SDK needed.

**Staging** answers *"does the release path work?"*, and it is the one that
catches what debug cannot. A debug APK is compiled with a different build type
— no minify, no proguard, no resource shrinking — so "worked in debug, broke in
production" is a real class of bug. The staging build uses `initWith
buildTypes.release`, so it differs from the Play artifact in exactly **one**
variable: the backend.

Two structural guarantees stop a staging build ever becoming the Play artifact,
because both failures would be silent:

- the `.staging` suffix, so it installs *beside* the production app rather than
  replacing the real NIETE app on a teacher's phone;
- the **debug** signing key, so Play rejects it on upload. The inherited NIETE
  release key is never given to a non-production workflow.

Both are asserted against the built APK, not just the gradle source
(`tests/portal/android-staging-identity.test.js`).

> The staging build type needs `matchingFallbacks = ['release']`: the Capacitor
> library modules publish only `debug` and `release` variants, so without it
> Gradle fails with *"No matching variant of project :capacitor-android"*.

## OTA updates (remote-first WebView)

The app is a pure WebView wrap with **zero native plugins**, so the web bundle
*is* the product. With OTA on, the WebView loads the SPA from the live portal
instead of the copy inside the APK — **a portal web deploy updates every
installed app on next launch**, no Play release, no review, no rollout.

| Change | How it ships | Reaches users in |
|---|---|---|
| Anything in `portal/src` — UI, copy, bug fixes | Deploy the portal | **Next app launch** |
| Capacitor upgrade, `MainActivity`, manifest, SDK, permissions, app icon | Play release | Days (review + rollout) |

Practically: almost everything is the first row. A bug like bd-2551 becomes a
web deploy, not a signed upload and a downtime notice.

**How it's wired.** `resolveOtaUrl()` in `src/lib/app-target.cjs` derives the
origin from `VITE_API_BASE_URL` — the same value the app already trusts for its
data — so the host serving the code can never drift from the host serving the
data. `capacitor.config.ts` sets `server.url` from it when `NIETE_OTA=1`.

> **⚠️ Do not re-tighten the native API-URL rule (bd-2554).** Under OTA the
> WebView runs the **web** bundle — served by the portal, so no
> `VITE_API_BASE_URL` — while Capacitor still injects its global, so
> `isNativeApp()` is **`true`**. An earlier version demanded an absolute URL
> whenever `isNative`, which threw at first render and would have white-screened
> every app the moment OTA was switched on: bd-2551 through a new door, and
> worse, because a Play rollback cannot fix a bundle served from the web.
>
> The rule is **not** "native ⇒ absolute URL". It is "**no usable origin** ⇒
> absolute URL". A bundled app sits on `https://localhost` where nothing is
> listening — that case must stay loud. A page *served by* a real https host
> can use the relative `/api/portal`, because there the page origin **is** the
> API's origin. `isServedByRealHost()` draws that line and fails closed on
> anything it doesn't recognise.
>
> A useful side effect: under OTA the API becomes **same-origin**, so the CORS
> allowlist (`https://localhost`, `capacitor://localhost` in
> `dashboard/index.js`) stops being load-bearing for app traffic. Keep those
> entries — the bundled fallback still needs them.

**It is opt-in** (`NIETE_OTA=1`; on by default in the release workflow, off for
debug builds so testers verify the PR's own code). If the origin can't be
derived, `server.url` is left unset and Capacitor uses the bundled assets — a
known-good floor rather than a blank shell. `resolveOtaUrl` never throws;
throwing at native boot is the white screen we're eliminating.

**Two things this makes load-bearing:**

1. **The bundled build still has to be correct.** It runs on first launch and
   whenever the server is unreachable. The CI app-mode check applies to every
   build for this reason.
2. **A bad portal deploy now reaches app users too.** The blast radius of the
   web deploy grew to include Android. Roll back the portal deploy to roll back
   the app.

Offline is unchanged: the portal is 100% server-data-driven and already
unusable without connectivity.

## Release signing

Release builds need the inherited NIETE signing key, supplied via environment
(see `keystore.properties.template`). Never commit the `.jks` or its passwords.

The identity is fixed: `CN=NIETE, O=Orenda Pvt Ltd`, alias `niete`, valid to
Feb 2049. **Play matches a listing by signing identity — a build signed with
any other key cannot update the existing app, ever.** CI asserts the resulting
bundle carries this exact SHA-256 before uploading.

For CI, the keystore is base64'd into the `NIETE_KEYSTORE_B64` secret
(`base64 -w0 niete-app.jks`); see the header of
`.github/workflows/android-release.yml` for the full secret list.

> ⚠️ **Unresolved risk — key escrow.** The `.jks` currently lives in the legacy
> `taleemabad-core` repo with its passwords in plain text in `build.gradle`.
> Losing it while not enrolled in Play App Signing means the listing can
> **never** be updated again. Whether Play App Signing is actually enabled for
> this listing is **unverified** — `app/build.gradle` asserts it in a comment,
> but nobody has confirmed it in the Play Console. Worth closing out.
