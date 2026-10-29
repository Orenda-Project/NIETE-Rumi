# coaching — Jest suites for coaching: guards, report sending, language, subject resolution

<!-- kg:meta repo=NIETE-Rumi dir=bot/tests/coaching kg=40befdeffaff gen=e50822945ceb overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `bd-n9832-terminal-guard-owners.test.js` — terminal guard contract
- `bd-v0toag-106-report-window-template.test.js` — 24h window template path
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `weekly-report/` | Jest suites for the weekly usage report and its fake supabase → `weekly-report/CLAUDE.md` |
| `bd-v0toag-127-template-error-detail.test.js` | Pins Meta's error code and message flowing sendTemplate to sendShare to template_not_sent logs (bd-v0toag.127) |
| `reflective-question-english-contract.test.js` | Pins the English reflective-question contract against Roman Urdu output in _generateReflectiveQuestionV12 |
| `latin-runs-coaching-print.test.js` | Pins that "&" in an English phrase prints as one run in the hero report and commitment card |
| `bd-n9832-terminal-guard-owners.test.js` | Pins session-terminal refuseTapIfTerminal/updateIfNotTerminal and updateStatus refusing writes (bd-n9832) |
| `bd-v0toag-106-report-window-template.test.js` | Pins report-window-send: share template when the 24h window is closed, follow-ups skipped (bd-v0toag.106) |
| `bd-v0toag-124-commit-prompt-template.test.js` | Pins sendCommitPrompt skipping the free-form commit prompt on the template path (bd-v0toag.124) |
| `bd-rw4so-confirm-refusal-language.test.js` | Pins that handleConfirmation's cancelled-session refusal uses the teacher's language, not English (bd-rw4so) |
| `bd-uwpohl-lesson-file-goes-to-app.test.js` | Drives the real webhook: a 30-min lesson sent as an audio file redirects app teachers to the app (bd-uwpohl) |
| `subject-tier3-app-opens.test.js` | Pins subject-resolution tier 3: an app-opened K-5 plan counts as a recent plan in resolveSessionSubject |
| `bd-2kxxa5-section-b-backfill.test.js` | Pins section-b-backfill: re-transcribe stranded sessions, recompute fidelity, CAS-guarded persist (bd-2kxxa.5) |

## Who reads this (generated)
- (none)

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/CLAUDE.md`? · `bot/shared/services/coaching/reflective-questions/CLAUDE.md`? · `bot/tests/CLAUDE.md`?
