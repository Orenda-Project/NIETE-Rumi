# profile — Coach More page and own profile

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/coach/profile kg=f71c1ee55504 gen=323d9a1cbd10 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `CoachMore.tsx` — identity, Language toggle, My profile, Log out
- `CoachProfile.tsx` — read-only name and phone, school counts, privacy and delete
- Tests colocated; run `cd portal && npx vitest run src/portal/coach/profile`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CoachMore.test.tsx` | Pins coach More: who they are, Language toggle, My profile, Log out, Learning assessment row (bd-4404s7.2) |
| `copy.ts` | English and Urdu words for coach More and My profile pages |
| `CoachProfile.test.tsx` | Pins coach profile: name and phone shown, Schools row, Privacy and Delete account (bd-4404s7.2) |
| `CLAUDE.md` | (unmapped) |
| `CoachMore.tsx` | Coach More page: identity card, Language toggle, My profile, Log out, optional child test row |
| `CoachProfile.tsx` | Coach's own profile with read-only name and phone, school counts, privacy and delete links |
| `useCoachCounts.ts` | Reads school and teacher counts from GET /coach/home for the profile pages |

## Who reads this (generated)
- `copy.ts` ← imported by `portal/src/portal/coach/insights/components/MoreCoachip.tsx:7:d008c2de` · `portal/src/portal/coach/pages/CoachHome.tsx:13:8f191f80` (+3)
- `useCoachCounts.ts` ← imported by `portal/src/portal/coach/profile/CoachMore.tsx:12:01da9c4b` · `portal/src/portal/coach/profile/CoachProfile.tsx:14:01da9c4b`
- `CoachMore.tsx` ← imported by `portal/src/App.tsx:139:78a58fe5`
- `CoachProfile.tsx` ← imported by `portal/src/App.tsx:144:00acb213`

## Never (human)
- Privacy policy and Delete account must stay findable in-app for Google Play (profile/CoachProfile.tsx:20, bd-3wb0s)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/coach/insights/tests/more.flagOff.test.tsx` (CoachMore.tsx)
- `portal/src/portal/coach/profile/CoachMore.test.tsx` (CoachMore.tsx)
- `portal/src/portal/coach/profile/CoachProfile.test.tsx` (CoachProfile.tsx)

## Related (generated)
- docs: `portal/src/portal/coach/CLAUDE.index.md`? · `portal/src/portal/coach/CLAUDE.md`? · `portal/src/portal/coach/insights/tests/CLAUDE.index.md`? · `portal/src/portal/coach/profile/CLAUDE.md`? · `portal/src/portal/hooks/CLAUDE.index.md`? · `portal/src/portal/hooks/CLAUDE.md`? (+1)
