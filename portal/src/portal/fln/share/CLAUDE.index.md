# share — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=portal/src/portal/fln/share -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `Fill.tsx` | Renders a catalogue string with {slot} values inside <bdi> in chrome digits so numbers keep direction in Urdu |
| `PlanCard.tsx` | Navy plan card for share panels: kicker (subject, level, lesson n/N) and title in plan language; sharePlanOf, Kicker |
| `SendSheet.test.tsx` | Vitest for "Send to teacher": keyed teacher ids, multi-select up to 30, POST /send, sent/partial/429/empty, 404 fallback |
| `SendSheet.tsx` | "Send to teacher" panel: pick own teachers, POST /fln/send so the bot messages each their own sign-in link |
| `ShareBar.test.tsx` | Vitest for the leaders' Share bar: renders only when me.share is true; two 48px buttons for leaders |
| `ShareBar.tsx` | Sticky bottom Share bar on a plan page for leaders (me.share), opens the Send-to-teacher or Share-link panels |
| `ShareSheet.tsx` | "Share link" panel: WhatsApp wa.me send, copy link with in-app-browser fallback, logs share/link_copy events |
| `Sheet.tsx` | Shared bottom-panel shell for both share panels: dimmed backdrop, title, Close, Escape closes, chrome lang/dir |
| `TeacherPicker.tsx` | Search and multi-select (max 30) of the leader's teachers via GET /fln/teachers; never draws a phone number |
| `api.ts` | Leader-side FLN API client (me, links, title, events, teachers, send): plain fetch, no-store, tagged results never throw |
| `message.test.ts` | Vitest for shareMessage: subject+level line in chrome language, plan-language title, URL alone with ?src=wa, 300 cp cap |
| `message.ts` | Builds the WhatsApp share text (kicker, title, ?src=wa URL on its own line), capped at 300 code points; withSrc |
| `share.css` | Styles for share panels, builder and login banner scoped under .fln-root; Urdu Nastaliq room for descenders |
| `strings.share.ts` | All EN+UR words for Share, Send, builder and login banner; shareStrings(lang), num() Urdu digits, SHARE_DIR |
| `testFetch.ts` | Test helper: stubFetch keyed by path fragment recording calls (to assert no-store); ME_LEADER fixture |
| `types.ts` | Minimal structural types (ShareMe, plan/placement shapes) Share reads from the plan page, mirroring fln/types.ts |
| `useFlnMe.ts` | useFlnMe hook: asks /fln/me on every mount (never cached); null while loading, false for no; langOf helper |

## Who reads this (all, generated)
- `Fill.tsx` ← imported by `portal/src/portal/fln/send/SendPage.tsx:20:529a5ba8` · `portal/src/portal/fln/share/PlanCard.tsx:6:242b3561` · `portal/src/portal/fln/share/SendSheet.tsx:12:242b3561` · `portal/src/portal/fln/share/TeacherPicker.tsx:11:242b3561`
- `PlanCard.tsx` ← imported by `portal/src/portal/fln/send/SendPage.tsx:22:5ed4a5ba` · `portal/src/portal/fln/share/SendSheet.tsx:13:9a257998` · `portal/src/portal/fln/share/ShareBar.tsx:15:29be0ea4` · `portal/src/portal/fln/share/ShareSheet.tsx:13:9a257998`
- `SendSheet.tsx` ← imported by `portal/src/portal/fln/send/SendPage.tsx:23:157323e4` · `portal/src/portal/fln/share/ShareBar.tsx:16:84e6b4d5`
- `ShareBar.tsx` ← imported by `portal/src/portal/fln/PlanPage.tsx:30:c18c3032`
- `ShareSheet.tsx` ← imported by `portal/src/portal/fln/send/SendPage.tsx:24:f013cfdc` · `portal/src/portal/fln/share/SendSheet.tsx:14:4333e5f4` · `portal/src/portal/fln/share/ShareBar.tsx:17:b35d4fb8`
- `Sheet.tsx` ← imported by `portal/src/portal/fln/share/SendSheet.tsx:15:0778e6f1` · `portal/src/portal/fln/share/ShareSheet.tsx:14:0778e6f1`
- `TeacherPicker.tsx` ← imported by `portal/src/portal/fln/share/SendSheet.tsx:16:b46708ca`
- `api.ts` ← imported by `portal/src/portal/fln/login/FlnLoginBanner.tsx:10:18fd8cd1` · `portal/src/portal/fln/send/SendPage.tsx:19:eb46caa9` · `portal/src/portal/fln/share/SendSheet.tsx:11:1d9f2c00` · `portal/src/portal/fln/share/ShareSheet.tsx:11:1d9f2c00` (+2: `python3 kg/kg.py who-reads api.ts`)
- `message.ts` ← imported by `portal/src/portal/fln/send/SendPage.tsx:21:936f1687` · `portal/src/portal/fln/share/ShareSheet.tsx:12:a3dd3795`
- `share.css` ← imported by `portal/src/portal/fln/FlnSendCard.tsx:10:3f397465` · `portal/src/portal/fln/FlnSendTile.tsx:12:3f397465` · `portal/src/portal/fln/login/FlnLoginBanner.tsx:12:3813371b` · `portal/src/portal/fln/send/SendPage.tsx:28:3813371b` (+2: `python3 kg/kg.py who-reads share.css`)
- `strings.share.ts` ← imported by `portal/src/portal/fln/FlnSendCard.tsx:8:b664e792` · `portal/src/portal/fln/FlnSendTile.tsx:10:b664e792` · `portal/src/portal/fln/login/FlnLoginBanner.tsx:11:1571eb69` · `portal/src/portal/fln/send/SendPage.tsx:25:02628c1f` (+10: `python3 kg/kg.py who-reads strings.share.ts`)
- `types.ts` ← imported by `portal/src/portal/fln/share/ShareBar.tsx:19:ed7fc2cc`
- `useFlnMe.ts` ← imported by `portal/src/portal/fln/FlnSendCard.tsx:9:1852ed88` · `portal/src/portal/fln/FlnSendTile.tsx:11:1852ed88` · `portal/src/portal/fln/send/SendPage.tsx:26:cc051e4d`

## Tests (all, generated)
- `SendSheet.tsx` ← `portal/src/portal/fln/share/SendSheet.test.tsx`
- `ShareBar.tsx` ← `portal/src/portal/fln/share/ShareBar.test.tsx` · `portal/src/portal/fln/tests/rootScope.test.tsx`
- `Sheet.tsx` ← `portal/src/portal/fln/tests/rootScope.test.tsx`
- `message.ts` ← `portal/src/portal/fln/share/message.test.ts`
- `testFetch.ts` ← `portal/src/portal/fln/FlnSendEntry.test.tsx` · `portal/src/portal/fln/hooks.test.tsx` · `portal/src/portal/fln/libraryHook.test.tsx` · `portal/src/portal/fln/login/FlnLoginBanner.test.tsx` · `portal/src/portal/fln/send/SendPage.test.tsx` · `portal/src/portal/fln/share/SendSheet.test.tsx` (+4: `python3 kg/kg.py who-reads portal/src/portal/fln/share/testFetch.ts`)

## Related (all, generated)
- docs: `portal/src/portal/fln/CLAUDE.md`?
