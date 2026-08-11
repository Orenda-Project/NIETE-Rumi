# NIETE Mobile Release Pipeline — Implementation Plan

**Beads**: bd-2542 (bundle API) · bd-2543 (internal release) · bd-2544 (production promote) · bd-2545 (OTA) · bd-2546 (support) · bd-2547 (skills)
**Author**: agent, 2026-08-11 · **Repo**: `Orenda-Project/NIETE-Rumi` (**PUBLIC**) · **Branch**: `bd-2542-25401` off `develop`

---

## 0. What already exists — the reference implementation

The pipeline being asked for **already exists in `taleemabad-core`** and runs in production today. This
plan is mostly a **port with defect fixes**, not a greenfield build. That is the single most important
framing: every design decision below is either "core did this and it works, keep it" or "core did this
and it is broken, here is the fix."

| Piece | In core | In NIETE-Rumi |
|---|---|---|
| Signed AAB build | `frontend/build-aab.sh` | ✅ `portal/android/`, documented in `niete-android-build` skill |
| Internal-track upload | ✅ `.github/workflows/release_internal_testing.yml` | ❌ manual drag-and-drop |
| Production promotion | ❌ **does not exist anywhere** | ❌ manual |
| OTA client | ✅ `frontend/libs/db/src/services/capacitor-update.ts` | ❌ nothing |
| OTA CI | ✅ 4 workflows (`niete`, `sed`, `staging` ×2 tenants) | ❌ nothing |
| Bundle API backend | ✅ Django, `taleemabad_core/apps/core/` | ❌ nothing |

**Operator decisions (2026-08-11)**, binding for this plan:
1. `taleemabad-core` is **retired** → no Play listing contention on `pk.edu.niete`; its creds are reusable.
2. Its Django backend **is still serving** `/api/v1/frontend-bundle/` → migration, not incident.
3. **Same AWS account, NEW dedicated bucket** for bundles.
4. **"No credentials can be sent to prod ever. It's an open repo."** → hard constraint, see §1.
5. Play service account JSON is available and current.

---

## 1. The security constraint that shapes everything

`NIETE-Rumi` is a **public repo** with `gitleaks` on every push and PR (`.github/workflows/secret-scan.yml`).

Core's four live-update workflows each carry this line **in plaintext, committed**:

```yaml
--header 'api_key: 7aeec18d-1529-4483-8475-607d5a16afa7'
```

Two things make this worse than a normal leak:

1. **The same key is used for staging AND production** (`staging_live_update.yml` and
   `niete_live_update.yml` are byte-identical on this header). A staging compromise is a production
   compromise.
2. It is **remote code delivery**. Anyone with that key can `POST` a zip that every NIETE and
   Balochistan device downloads and executes on next launch. This is strictly more dangerous than a
   database credential.

**Rules for this port, non-negotiable:**

- The bundle upload key lives in **GitHub Actions secrets** (`OTA_UPLOAD_API_KEY`), referenced as
  `${{ secrets.OTA_UPLOAD_API_KEY }}`. It never appears in a workflow file, a test fixture, a doc, or
  a commit message.
- **Separate keys per channel.** `OTA_UPLOAD_API_KEY_INTERNAL` and `OTA_UPLOAD_API_KEY_PRODUCTION`.
  Compromise of one must not reach the other.
- The new S3 bucket gets its **own IAM user** scoped to that bucket only — not the core credentials,
  which have access to whatever else core's bucket held.
- `.gitleaks.toml` gets a rule for the bundle-key shape so a future paste is caught by CI, and the
  **existing core key is treated as burned** — it must be rotated on the Django side before that
  service is decommissioned, since it is already public in core's git history.

> **Open item for the operator**: core's key is in git history and cannot be un-published. Rotating it
> requires touching the still-serving Django backend. Flagged, not actioned — see §8.

---

## 2. Architecture — two trains, one compatibility contract

```
NATIVE TRAIN (slow, Play-gated)          OTA TRAIN (fast, ours)
  AAB → internal → production              bundle → internal ch. → production ch.
  days, Play review, staged rollout        minutes, staged rollout, auto-rollback
        │                                        │
        └──────────── versionCode ───────────────┘
                  minNativeVersion
```

The two trains are joined by exactly one contract: **every OTA bundle declares the minimum native
`versionCode` it can run on, and a device refuses any bundle whose `min_native_version` exceeds its own
installed `versionCode`.**

Core has no such field. That is the skew bug: a JS bundle calling a new Capacitor plugin lands on an
old binary and crashes on a code path nobody tested. Capgo's plugin supports this natively; core simply
never used it.

---

## 3. Step 0 — Bundle API in NIETE-Rumi (bd-2542)

### 3.1 Why we own it

The endpoint the shipped app depends on is `FrontendBundleAPIView` in the **retired** repo. It works
today; it becomes a silent total failure the day that Django service stops — silent because the client
swallows every error (§5.2). Owning it is the prerequisite for everything else.

### 3.2 What core got right (keep)

- S3 storage + **presigned URLs** (1h) rather than serving zips from the app server.
- API-key gate on both read and write (`permission_classes = [HasAPIKey]`).
- `.zip`-only validation (`validate_frontend_bundle`).
- Serving only the **latest 3** bundles — bounded response, no unbounded history.
- On upload failure, the DB row is deleted rather than left dangling (`s3_clients.py`).

### 3.3 What core got wrong (fix)

| Core | Problem | Fix |
|---|---|---|
| `version = AutoField(primary_key=True)` | The OTA version **is a Postgres autoincrement PK**. Cannot be set deliberately, cannot be reasoned about against `versionCode`, cannot express compatibility. | Explicit `bundle_version` (monotonic int, set by CI) with the PK as a separate surrogate. |
| No `min_native_version` | Skew crash (§2). | Required field, validated on upload. |
| `environment` = tenant (`niete`/`balochistan`) | Conflated with release channel; there is no channel concept at all. | Keep `environment` for tenant, **add `channel`** (`internal`/`production`). |
| No rollout control | Push → 100% of devices. | `rollout_percent` (0–100), deterministic per-device bucketing. |
| No apply telemetry | Blind rollout, §5.2. | `POST /api/v1/frontend-bundle/telemetry/`. |

### 3.4 Implementation

Express, mounted alongside the existing pattern. `bot/whatsapp-bot.js:51` already does
`app.use('/api/internal', internalApiRoutes)`; the model to follow is
`bot/shared/routes/internal-api.routes.js`, including its `requireInternalKey` middleware — which
correctly **rejects when the key env var is unset** rather than comparing `undefined === undefined`.

New files:

```
bot/shared/routes/frontend-bundle.routes.js     # GET list, POST upload, POST telemetry
bot/shared/services/bundle-storage.service.js   # S3 put + presign, new bucket
bot/database/migrations/NNNN_frontend_bundles.sql
```

Schema (Supabase/Postgres, per Rule 15 — verify live schema before applying; no new table if an
existing one fits, but nothing here does):

```sql
create table frontend_bundles (
  id                 uuid primary key default gen_random_uuid(),
  bundle_version     integer not null,
  min_native_version integer not null,
  channel            text    not null check (channel in ('internal','production')),
  environment        text    not null,
  rollout_percent    integer not null default 0 check (rollout_percent between 0 and 100),
  bundle_url         text    not null,
  checksum_sha256    text    not null,
  created_at         timestamptz not null default now(),
  unique (environment, channel, bundle_version)
);
```

`checksum_sha256` is new — core never verified bundle integrity. The client checks it before applying.

### 3.5 The old app is already retired — what that changes

**The old fleet has already been dead-ended by an OTA.** Operator, 2026-08-11: the new AAB has shipped
to Play several times, and the previous bundle was a **retirement bundle** that blocks the app and asks
users to update.

`frontend/apps/school-app/src/features/retirement/pages/app-retired-page.tsx` + `routes/index.tsx`:
every route resolves to one unskippable notice with a Play Store button. No navigation off it, back
button minimises, no auth or network dependency so it renders for a logged-out user with an empty
IndexedDB on the oldest device in the field.

Both apps are `pk.edu.niete` (core's `build.gradle:65`, NIETE-Rumi's `capacitor.config.ts`), so the new
build is an **in-place upgrade**, not a second listing.

Consequences for this plan:

- **There is effectively no dual-publish window.** No live old fleet needs ongoing OTAs — only a
  dead-ended one showing an update notice. The main argument for reusing core's bucket disappears; the
  operator's new-bucket choice is cleanly correct.
- Core's Django still serves **that one terminal bundle** to devices that have not yet updated, so it
  cannot be switched off — but it is serving a stop screen, not a working app.
- **The retirement is a one-way door with no remote undo.** A device that took it shows that screen
  forever; the only exit is a Play update. A teacher who cannot update (old Android, no Play Services,
  no storage, poor connectivity) has no working app and no lever we can pull. Deliberate and reasonable
  for a retirement, but it makes one question load-bearing: **how many devices are still on the old
  bundle?** Not answerable from the repo — needs Play Console vitals or bundle-API request logs. See
  §10.6.

**It also proves the mechanism this plan rests on.** The retirement bundle was written *around* Capgo's
rollback watchdog — from the file's own comments: *"`main.tsx` is deliberately untouched. Capgo rolls a
bundle back if `notifyAppReady()` is not called within ~10s of launch, so the app must keep booting
normally."* A shipped production bundle had to route around auto-rollback, so the watchdog is armed in
production, not merely documented. §8.3 check 3 moves from unknown risk to expected-pass — it is still
run on hardware, because designed-around is not watched-fire (Rule 16: defined ≠ working).

### 3.6 What gets duplicated, and the dual-publish window

**Duplicated**: the upload + presign *logic*. Core's `S3FrontendBundleClient` (`upload_fileobj` into a
`frontend-bundles/` prefix, save object URL to the row, 1h presigned GET) is reimplemented in
`bot/shared/services/bundle-storage.service.js` — boto3 → `@aws-sdk`. A port, not a shared library:
different languages, different repos.

**Not duplicated**: the bucket, and the bundle history. New dedicated bucket (operator, 2026-08-11), and
**no backfill of old bundles into it**. Backfilling would mean reconciling core's `AutoField` version
numbers with our explicit `bundle_version` — importing the exact design flaw §3.3 exists to drop.

During the overlap **two independent upload paths are live at once**:

| | Core (Django) | NIETE-Rumi (Express) |
|---|---|---|
| Bucket | core's existing | **new, dedicated** |
| Written by | core's 4 workflows | new `live-update.yml` |
| Read by | **apps already in the field** | apps from the next AAB onward |

Per §3.5 this table is **not** a live dual-publish obligation. Core's column serves one terminal
retirement bundle to not-yet-updated devices; it receives no new releases. We publish to ours only.

We never write to core's bucket, and never backfill from it.

**Route contract** (`GET /api/v1/frontend-bundle/?channel=production&native=1205`):
returns the highest `bundle_version` on that channel where `min_native_version <= native` **and** the
device falls inside `rollout_percent`. Filtering server-side means an ineligible device never sees a
bundle it must not install — the old client-side `max()` reduce cannot express this.

Bucketing is `sha256(device_id + bundle_version) % 100 < rollout_percent` — deterministic, so a device
does not flip in and out of the cohort as the percentage rises.

---

## 4. Step 1 — Internal-track release CI (bd-2543)

Port of `release_internal_testing.yml` → `.github/workflows/release-internal.yml`.

### 4.1 Keep from core

- `versionCode` auto-bump with **bot-commit loop guard**
  (`if: "!contains(github.event.head_commit.message, 'chore: bump versionCode')"`) — without it the
  bot's own push retriggers the workflow forever.
- Rebase-before-push on the release branch (concurrent runs).
- AAB existence assertion before upload.
- `r0adkll/upload-google-play@v1.1.3` with `track: internal`, `packageName: pk.edu.niete`.
- Service-account JSON written from a secret at run time, never committed.

### 4.2 Change from core

| Core | NIETE-Rumi | Why |
|---|---|---|
| `openjdk-17-jdk` | **Java 21** (`temurin-21-jdk`) | Repo pins Gradle 8.14.3 + AGP 8.13.0. The `niete-android-build` skill documents this: default `java` on the box is 25 and **cannot** be used. |
| `frontend/apps/school-app/...` | `portal/...` | Different layout. |
| `./frontend/build-aab.sh niete` | `vite build` → `cap sync android` → `bundleRelease` | Core's script; ours must include the **stale-UI guard** — skip `cap sync` and you ship an old UI inside a fresh AAB. |
| No signature check | **`jarsigner -verify` hard gate** | The highest-value addition. Missing any one of the four `NIETE_*` env vars makes `hasNieteSigning` false, skips signing **silently**, and still reports BUILD SUCCESSFUL. Play then rejects the upload. |
| `versionCode` free-runs | Must reconcile with `tests/portal/android-release-identity.test.js` floor (**currently 1205**) | That test asserts a floor tracking *uploaded*, not *built*. CI bumping the code without bumping the floor makes the test a no-op; the workflow updates both. |

### 4.3 Trigger

`workflow_dispatch` **only** for the first release. Core triggers on push to `release/internal-testing`;
we do not adopt that until the signature gate has proven itself on a few manual runs.

---

## 5. Step 2 — Production promotion (bd-2544)

**Does not exist in core. Genuinely new.**

`workflow_dispatch` taking `versionCode` + `rollout_percent`, calling the Play Developer API to promote
the **exact artifact already on internal** — no rebuild, so the bytes tested are the bytes shipped.

- Guarded by a GitHub **environment** with required reviewers → cannot fire without a human click.
  This is CLAUDE.md Rule 7: production reach needs an explicit per-action "go", and a previous "yes do
  X" does not approve downstream steps.
- Default `rollout_percent: 10`.
- Sibling actions: `halt` (Play `inProgress` → `halted`) and `bump-rollout`.
- Refuses to promote a `versionCode` not currently on the internal track.

---

## 6. Step 3 — OTA live update (bd-2545)

### 6.1 Client

Port `capacitor-update.ts` → `portal/src/services/live-update.ts`, keeping the shape that works:

- `CapacitorUpdater.notifyAppReady()` on boot — **arms Capgo's rollback watchdog**. A bundle that fails
  to reach ready is reverted automatically. This is the single most important safety mechanic and core
  does have it.
- Download now, **apply on next launch** — never swaps under a user mid-task.
- Remote `liveUpdateEnabled` feature flag — kill switch without a release.
- Download only while the app is active.

### 6.2 The six defects, fixed

1. **Hardcoded API key** → GitHub secrets, per-channel (§1).
2. **`catch (err) {}` — twice, completely empty.** Every OTA failure is invisible today: you cannot tell
   how many devices took a bundle or how many broke. Fix: structured logging + `POST .../telemetry/`
   on both success and failure. **Staged rollout is impossible without this** — there is nothing to
   measure and auto-halt has no signal.
3. **No `minNativeVersion`** → sent as a query param, enforced server-side (§3.4).
4. **No channels / gate / staged rollout** → `channel` + `rollout_percent`.
5. **`build-sync.sh` runs `--configuration=development`** — core ships a **development build to
   production devices**. Ours builds production config, and a test asserts it.
6. **`a.version > b.version` on possibly-string values**, then `Number()`-coerced client-side. Server
   now picks the winner; the client compares integers it validated.

Plus: **verify `checksum_sha256`** before applying.

### 6.3 CI

`.github/workflows/live-update.yml`, `workflow_dispatch`, publishing to the **internal channel by
default**. Promotion to the production channel is a separate gated action, mirroring §5.

**No auto-send on backend release.** The pipeline makes OTA *safe*, not *free*; the internal→production
gate is doing the work. What the operator gets is prod release auto-**building and staging** a bundle on
the internal channel, so activation is one command instead of a manual build.

---

## 7. Step 4 — Support (bd-2546)

- **Native-change detector** — diffs `portal/android/`, `capacitor.config.ts`, and Capacitor plugin deps
  in `portal/package.json`. If any changed, the OTA workflow **refuses to publish** and instructs an AAB
  release. Automated form of the skew guard.
- **Version ledger** `portal/release-ledger.json` — what `versionCode` is on internal, on production,
  and which bundle sits on each OTA channel. Replaces the stale-comment-in-a-test pattern that already
  caused a **wasted build at 1203**.
- **Boot telemetry** surfaced on the existing dashboard.
- **`tests/portal/ota-safety.test.js`** — red-first per Rule 6.

---

## 8. Testing — how we know each piece works

Per Rule 6 every code fix is red-first: write the failing test, **run it and prove it fails**, implement,
prove green plus the affected suite at baseline. Per Rule 16, "defined ≠ working" — each layer below is
proven against the live artifact, not asserted.

### 8.1 Automated, no devices needed

| Test | Proves | Red-first how |
|---|---|---|
| `ota-safety.test.js::rejects bundle without min_native_version` | Skew guard cannot be bypassed | Write test → fails (no validation exists) → add validation |
| `ota-safety.test.js::device on 1205 never offered a bundle needing 1206` | Server-side eligibility | Seed both, assert the 1206 bundle is absent from the 1205 response |
| `ota-safety.test.js::rollout bucketing is deterministic` | A device does not flip cohorts | Same `device_id` + version → same bucket across 1000 calls |
| `ota-safety.test.js::checksum mismatch refuses apply` | Integrity | Corrupt one byte, assert refusal |
| `ota-safety.test.js::production build config` | Defect #5 | Assert built bundle carries no dev-mode marker |
| `native-change-detector.test.js` | OTA refused when native changed | Stage a fake plugin bump, assert refusal |
| `release-identity` (existing, extend) | `versionCode` floor moves with uploads | Extend to read the ledger |
| CI: `gitleaks` + new bundle-key rule | Defect #1 cannot recur | Add the core key shape as a fixture, assert CI fails on it |

### 8.2 Staging, before any device

- Publish a bundle to the **internal channel of the staging tenant**; assert via `GET` that it appears
  for an eligible native version and not for an ineligible one.
- Assert the presigned URL actually downloads and the checksum matches.
- Assert an unauthenticated `POST` is rejected (401), and a **wrong-channel key** is rejected — proving
  the per-channel key separation is real, not just declared.

### 8.3 Device tests (the ones that actually matter)

Precedent exists: `ANDROID.md` records a real-hardware pass on a Realme RMX2061 (2026-07-29), and the
same doc marks the known-broken session-persistence check (bd-2358) so a tester does not re-report it.
The OTA equivalents:

| # | Check | Pass criterion |
|---|---|---|
| 1 | Install internal-track AAB from Play | App opens on the portal login screen |
| 2 | Publish bundle to internal channel, background/reopen | New UI appears on **second** launch, not first |
| 3 | **Deliberately publish a broken bundle** to internal | App **auto-reverts** to previous bundle and remains usable. This is the test that decides whether auto-send is ever safe. Do this on internal, on a spare device, never on production. |
| 4 | Publish a bundle with `min_native_version` above the device's | Device does **not** download it |
| 5 | Flip `liveUpdateEnabled` off, publish | No download — kill switch works |
| 6 | Airplane mode during download | Fails silently, app still usable, telemetry records it on reconnect |
| 7 | Set `rollout_percent: 0`, then 100 | No device gets it at 0; devices get it at 100 |

Check 3 is the gate on the whole project. If auto-rollback does not work on real hardware, OTA stays
internal-only until it does.

### 8.4 Production rollout

10% → watch boot-success telemetry for 24h → 50% → 100%, with halt available at each step. Nothing
promotes to the production channel without an explicit "go".

---

## 9. Sequence

| Order | Bead | Blocked by | Deliverable |
|---|---|---|---|
| 1 | bd-2542 | New bucket + IAM (operator) | Bundle API on staging, §8.1–8.2 green |
| 2 | bd-2543 | Play SA in repo secrets (operator) | Internal AAB via CI, signature-verified |
| 3 | bd-2545 | 1, 2 | OTA to internal channel, §8.3 checks 1–7 |
| 4 | bd-2546 | 3 | Telemetry, detector, ledger |
| 5 | bd-2544 | 2, 4 | Gated production promotion |
| 6 | bd-2547 | all | Four skills, **written after a real run** |

Skills come last deliberately. A skill documenting a pipeline that has not been run encodes assumptions
rather than behaviour — and this repo's skills are good precisely because they record the traps
(silent-unsigned bundle, two `dist` directories, the wasted 1203 build) that only surface on a real run.

---

## 10. Open items for the operator

1. **Core's OTA key is public in git history** and cannot be un-published. Rotating it means touching
   the still-serving Django backend. Flagged, not actioned.
2. **New bucket + IAM user** — needs creating (same AWS account, per operator). Bucket name and scoped
   IAM policy to confirm.
3. **`GOOGLE_PLAYSTORE_SERVICE_ACCOUNT_KEY`** must be added to NIETE-Rumi repo secrets — repo-admin
   action.
4. **Device for check 3** (deliberately-broken bundle). Should not be a teacher's phone.
5. **Migration of already-installed apps** — largely resolved by the retirement bundle (§3.5). The old
   fleet is dead-ended on a stop screen, not depending on core for functionality, and the new AAB
   upgrades in place under the same `pk.edu.niete`. Core's Django keeps serving that one terminal
   bundle until the stragglers update, so it stays up, but nothing new ships to it.
6. **How many devices are still on the old bundle?** Not answerable from the repo — needs Play Console
   vitals or bundle-API request logs. Load-bearing because the retirement block has **no remote undo**:
   a teacher who cannot update has no working app and no lever we can pull. If the number is material
   it is a support problem now, and it is also the honest baseline for what "OTA reach" means.
