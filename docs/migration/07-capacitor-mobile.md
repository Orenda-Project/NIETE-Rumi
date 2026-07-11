# 07 — Capacitor Mobile App (Deferred)

**Status**: 🟡 Deferred — do at end of migration
**Depends on**: [00-scope-and-decisions](./00-scope-and-decisions.md) D-001 phase 2

---

## Scope

Wrap the fork's web portal (Vite + React + Tailwind at `rumi-platform/portal/`) into a **Capacitor Android/iOS build**, matching Taleemabad's `school-app` delivery model — coaches and admins can install it as a Play Store app instead of using a browser.

This is a **build/deploy transformation**, not a rewrite. The React components, routes, and portal features stay the same.

## Why deferred

- **Feature workstreams first**: LP catalog, teacher training, coach HITL, exam gen all deliver value in phase 1 via the web portal. Capacitor adds nothing to those features that a mobile browser doesn't already give.
- **Scope discipline**: shipping a Play Store app requires (a) icon assets, (b) app-store screenshots, (c) release signing, (d) Play Console setup, (e) review turnaround (~1 week per submission), (f) native permission plumbing (camera, storage, notifications), (g) offline caching strategy. None of these block phase 1.
- **Design point**: web-first proves the surfaces work before mobile-app polish. Once we know which portal pages coaches actually use, we know which need offline caching in the Capacitor build.

## What we'll do (phase 2)

Rough shape — flesh out when we start:

1. **Add Capacitor to the portal build**
   - `cd rumi-platform/portal && npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios`
   - `npx cap init` with region-appropriate app ID (e.g. `com.rumi.<region>`)
   - `npx cap add android` + `npx cap add ios`

2. **Configure build script** — mirror Taleemabad's `build-apk.sh` / `build-aab.sh` pattern from `taleemabad-core/frontend/`

3. **Offline caching strategy** — decide which portal routes need offline support:
   - Coach queue: yes (coach reviews sessions in the field)
   - Training progress: probably no (needs live DB reads)
   - Admin pages: no (connectivity assumed)

4. **Dexie integration** (optional) — mirror portal data locally for offline read. Taleemabad ships a `libs/db` Dexie layer; we can port that pattern if offline is critical. Skip if online-only is acceptable.

5. **Native permissions** — camera (for coach photo uploads), storage (for downloaded reports), notifications (for coach queue alerts).

6. **Play Store submission** — icon, screenshots, description, signing key, listing.

7. **iOS App Store submission** — only if the region wants iOS coverage. Adds Apple Developer account + review overhead.

## Reference

- Taleemabad's Capacitor setup: `taleemabad-core/frontend/apps/school-app/` (Nx app), `taleemabad-core/frontend/build-apk.sh`, `taleemabad-core/frontend/build-aab.sh`
- Console-logging safety on Capacitor Android — see `taleemabad-core/.claude/rules/console-logging-safety.md` (Capacitor's Android bridge OOMs on unbounded console args — a real production incident there). Bake this rule in before shipping.

## Open items

- Which regions want iOS in addition to Android?
- App branding — region-specific or Rumi-wide?
- Do we ship a single Capacitor app that handles multiple regions (login picks region), or one Play Store listing per region?
- Timing — end of phase 1, or a specific milestone?
