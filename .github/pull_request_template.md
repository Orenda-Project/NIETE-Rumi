<!--
PRs go into `sandbox`. Fill in every section; write "none" where one does not apply.
This repo is public: no phone numbers, real names, keys or internal ticket ids anywhere in this PR.
-->

## What

<!-- One or two lines: what changes for the person using it (teacher, coach, principal, analytics account). -->

## Why

<!-- The problem or the ask, in plain words. Link the request if there is one. -->

## How it was tested

<!-- The red test you wrote first and the command that runs it, then what you checked by hand on sandbox. -->

- [ ] Wrote the failing test first, then made it pass: `…`
- [ ] Portal: `cd portal && npx vitest run src/portal/<folder>` passes, and `npm run build --prefix portal` builds
- [ ] Server or bot: `npm test` exits 0 (no new failure against the baseline)
- [ ] Tried it on sandbox with a test account (a "Testwala" account, never a real teacher)

## Screenshots

<!-- Every screen you added or changed, from sandbox or dev-portal, test accounts only. -->

| | English | Urdu |
|---|---|---|
| Phone, 360 px wide | | |
| Desktop, 1280 px wide | | |

## Switch

<!-- The app_settings key that turns this on, what OFF looks like, and who should get it first.
     New behaviour ships OFF. "none" only for a fix that changes no behaviour. -->

- Key:
- Off means:
- Turn on for:

## Before review

- [ ] Branched from `sandbox`, and this PR goes into `sandbox`
- [ ] Words are in `copy.ts`, in English and Urdu (machine-drafted Urdu marked for a human read)
- [ ] No secret, phone number, real name or ticket id in the code, tests or this PR
- [ ] Merged into `sandbox`, the sandbox deploy finished, and it works there
- [ ] **Ready for review** (tick last, then send this PR's link to the product owner in a direct message)
