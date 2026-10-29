# share — Leader sharing: Share bar, send to teachers, share link, WhatsApp text
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=portal/src/portal/fln/share kg=7ead536b4553 gen=2b5f4f9a4233 overflow=30 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `ShareBar.tsx` — sticky bar, renders only when me.share
- `message.ts` — builds the WhatsApp text (300 code point cap)
- Tests (`*.test.ts(x)`): vitest, `cd portal && npx vitest run src/portal/fln/share`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `strings.share.ts` | All EN+UR words for Share, Send, builder and login banner; shareStrings(lang), num() Urdu digits, SHARE_DIR |
| `testFetch.ts` | Test helper: stubFetch keyed by path fragment recording calls (to assert no-store); ME_LEADER fixture |
| `api.ts` | Leader-side FLN API client (me, links, title, events, teachers, send): plain fetch, no-store, tagged results never throw |
| `Fill.tsx` | Renders a catalogue string with {slot} values inside <bdi> in chrome digits so numbers keep direction in Urdu |
| `SendSheet.test.tsx` | Vitest for "Send to teacher": keyed teacher ids, multi-select up to 30, POST /send, sent/partial/429/empty, 404 fallback |
| … | 12 more → `CLAUDE.index.md` |

## Who reads this (generated)
- `strings.share.ts` ← imported by `portal/src/portal/fln/FlnSendCard.tsx:8:b664e792` · `portal/src/portal/fln/FlnSendTile.tsx:10:b664e792` (+12)
- `api.ts` ← imported by `portal/src/portal/fln/login/FlnLoginBanner.tsx:10:18fd8cd1` · `portal/src/portal/fln/send/SendPage.tsx:19:eb46caa9` (+4)
- `share.css` ← imported by `portal/src/portal/fln/FlnSendCard.tsx:10:3f397465` · `portal/src/portal/fln/FlnSendTile.tsx:12:3f397465` (+4)
- `Fill.tsx` ← imported by `portal/src/portal/fln/send/SendPage.tsx:20:529a5ba8` · `portal/src/portal/fln/share/PlanCard.tsx:6:242b3561` (+2)
- … 9 more → `CLAUDE.index.md`

## Never (human)
- Never draw a phone number: only keyed id, name, school (TeacherPicker.tsx:3)
- Share text capped at 300 code points; cut the title, never the URL (message.ts:14)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- `portal/src/portal/fln/tests/rootScope.test.tsx` (ShareBar.tsx, Sheet.tsx, testFetch.ts)
- `portal/src/portal/fln/share/SendSheet.test.tsx` (SendSheet.tsx, testFetch.ts)
- … 9 more → `CLAUDE.index.md`

## Related (generated)
- docs: `portal/src/portal/fln/CLAUDE.md`?
