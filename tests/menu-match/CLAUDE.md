# menu-match — Tests that unmatched messages and voice notes route via the teacher's live menu

<!-- kg:meta repo=NIETE-Rumi dir=tests/menu-match kg=0613286f6176 gen=c57c5240ac05 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `fallthrough-routing.test.js` — typed text to the closest live-menu feature (bd-xw56ed)
- `classifier-reads-live-menu.test.js` — classifier choices come from the live menu
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/menu-match --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `classifier-reads-live-menu.test.js` | bd-xw56ed: the fallthrough intent classifier picks from the teacher's live menu rows, not four fixed labels |
| `fallthrough-routing.test.js` | bd-xw56ed: an unmatched typed message routes to the closest live-menu feature (IAB button) via text-message.handler |
| `voice-routing.test.js` | bd-xw56ed: a voice note is classified against the same live menu and opens the row, not-sure line or menu |
| `chat-no-presentations.test.js` | bd-xw56ed: the help/chat capability list in openai.service no longer promises to make presentations |
| `CLAUDE.md` | (unmapped) |

## Who reads this (generated)
- (none)

## Never (human)
- The intent classifier must read the live menu, not a fixed label list (classifier-reads-live-menu.test.js:3)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/config/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/menu-match/CLAUDE.md`?
