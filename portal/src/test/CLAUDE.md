# test — Vitest guards on the shipped shell: index.html, brand tokens, route chunks, boot reads

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/test kg=2563c2ad06f1 gen=5478cc7461fc overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `routeChunks.test.tsx` — every non-entry page in App.tsx must be a lazy chunk
- `setup.ts` — jest-dom matchers and Node 25 localStorage fix
- Tests are vitest (portal/vitest.config.ts, jsdom, setup src/test/setup.ts): `cd portal && npx vitest run src/test`.
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `trainingFixtures.ts` | Training fixtures (vendors, levels, modules, unit locks) shaped like the training API, for Training screen tests |
| `appBootPrime.test.tsx` | Imports App.tsx at a coach's path: /coachip/home starts at boot only if /config says the switch is on (bd-sex15q.34) |
| `CLAUDE.md` | (unmapped) |
| `routeChunks.test.tsx` | Reads App.tsx: entry pages stay in the first chunk, every other page is a lazy chunk (bd-fxk3t8) |
| `brand-tokens.test.ts` | Pins NIETE brand book navy #333748 in index.css, hero gradient, theme-color and favicon (bd-2457) |
| `indexHtmlBoot.test.ts` | Runs index.html's coachip-boot script: /config and /me fetched on coach and RM paths only, not native (bd-sex15q.34) |
| `indexHtmlShell.test.ts` | Pins index.html's static shell: #root non-empty, no network URLs (Capacitor-safe), reduced-motion respect (bd-fxk3t8) |
| `portal-audience.test.ts` | Asserts shared chrome (login, title, 404) says 'NIETE Portal', never 'Teacher Portal' (bd-2468) |
| `setup.ts` | Vitest setup: jest-dom matchers and a localStorage/sessionStorage restore for Node 25 (bd-omk735) |

## Who reads this (generated)
- (none)

## Never (human)
- Put network URLs in index.html's static shell: it is the Capacitor entry and must work offline (indexHtmlShell.test.ts)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `portal/src/CLAUDE.index.md`? · `portal/src/CLAUDE.md`? · `portal/src/portal/coach/insights/CLAUDE.index.md`? · `portal/src/portal/lib/CLAUDE.index.md`? · `portal/src/test/CLAUDE.md`?
