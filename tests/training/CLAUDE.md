# training — Tests teacher training: levels, quizzes, exams, certificates, I-SAPS and portal routes
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=tests/training kg=db1209e8d052 gen=d54cbc1bc475 overflow=64 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `portal-grand-quiz.test.js` — portal level-exam endpoints; `quiz-delivery` tests list WhatsApp side
- `certificate-service.test.js` — shared certificate issuance (bot and portal)
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/training --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `isaps*` | 10 files; most used `isaps-golive-gates.test.js`: bd-vej4h: I-SAPS go-live gates: open modules, per-module unit chaining, module exam waits for its units |
| `quiz*` | 6 files; most used `quiz-multi-select-flow.test.js`: bd-2501: multi-answer quiz questions go out as a Flow CheckboxGroup (token has attempt and index); single stays a list |
| `web*` | 3 files; most used `web-training-link.test.js`: Pins opening Training sending the training_open_v1 web-link template when web_training_enabled allows the teacher |
| `CLAUDE.md` | (unmapped) |
| `capstone*` | 4 files; most used `capstone-reachable.test.js`: bd-2472/2473/2474: the capstone is offered after the last quizzed module of a Beacon House level; no dead end |
| `bd-w2daa-8-fewer-bubbles.test.js` | bd-w2daa.8: Teacher Training merges verdict and next question into fewer billed WhatsApp sends, same words |
| `portal*` | 15 files; most used `portal-grand-quiz-served.test.js`: bd-klecr.7: the portal level exam serves the bot's per-attempt paper, resumes the same attempt on reload |
| … | 64 more → `CLAUDE.index.md` |

## Who reads this (generated)
- env read here: `NODE_ENV` · `OPENROUTER_API_KEY`

## Never (human)
- A module quick-check or diagnostic must not certify a level (level-passed-requires-grand-attempt.test.js:2)
- One certificate per (user, level) (certificate-one-per-level.test.js:2)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/scripts/setup/CLAUDE.index.md`? · `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/services/training/CLAUDE.index.md`? · `bot/shared/services/training/CLAUDE.md`? · `dashboard/routes/CLAUDE.index.md`? · `dashboard/services/CLAUDE.index.md`? (+12)
