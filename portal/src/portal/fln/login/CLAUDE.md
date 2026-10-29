# login — FLN banner and next= exports used by the portal sign-in page

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/fln/login kg=70667745043e gen=22a6866b2a24 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `FlnLoginBanner.tsx` — bilingual banner for a shared plan link
- `index.ts` — one-import surface for the sign-in page
- `FlnLoginBanner.test.tsx` — vitest: `cd portal && npx vitest run src/portal/fln/login`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `FlnLoginBanner.test.tsx` | Vitest: sign-in banner shows plan title plus bilingual "Sign in to open" for FLN next= links, nothing otherwise |
| `FlnLoginBanner.tsx` | Sign-in page banner for a shared plan link: plan title from /fln/title/:id plus bilingual sign-in prompt |
| `index.ts` | Barrel exporting FlnLoginBanner, safeNext and goAfterSignIn for the sign-in page |

## Who reads this (generated)
- `FlnLoginBanner.tsx` ← imported by `portal/src/portal/fln/login/index.ts:2:44163e6e`
- `index.ts` ← imported by `portal/src/portal/pages/PortalLogin.tsx:7:e15eaf38`

## Never (human)
- Banner is always bilingual: receiver language is unknown before sign-in (FlnLoginBanner.tsx:3-4)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/fln/login/FlnLoginBanner.test.tsx` (FlnLoginBanner.tsx)
- `portal/src/portal/fln/tests/rootScope.test.tsx` (FlnLoginBanner.tsx)

## Related (generated)
- docs: `portal/src/portal/fln/CLAUDE.md`?
