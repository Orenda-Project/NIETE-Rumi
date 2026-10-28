# workers — Tests worker process signals: web drain and the PDF renderer under SIGTERM

<!-- kg:meta repo=NIETE-Rumi dir=tests/workers kg=d8d0ef030025 gen=781940500ea2 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `web-drain.test.js` — SIGTERM waits for post-ack webhook work
- `html-to-pdf-sigterm.test.js` — loading the renderer must not take over SIGTERM
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/workers --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `html-to-pdf-launch-signals.test.js` | Pins that html-to-pdf launches Chromium with Playwright SIGTERM/SIGINT/SIGHUP handlers off so it survives a drain |
| `web-drain.test.js` | Pins web-drain: SIGTERM waits for post-ack webhook work to finish, and exits at once when idle |
| `CLAUDE.md` | (unmapped) |
| `html-to-pdf-sigterm.test.js` | Pins that loading the PDF renderer does not register its own SIGTERM handler that would cut a worker's drain |

## Who reads this (generated)
- env read here: `HTML_TO_PDF_UNDER_TEST`

## Never (human)
- A deploy must not cut off webhook work done after the ack (web-drain.test.js:3)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/workers/CLAUDE.md`?
