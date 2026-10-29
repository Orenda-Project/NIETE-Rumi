# assets — Generate and upload Flow JSON and reading-passage background assets

<!-- kg:meta repo=NIETE-Rumi dir=bot/scripts/assets kg=94d04bbc6fc1 gen=218571bee6a3 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `upload-flow.js` — push a Flow JSON to Meta
- `generate-passage-backgrounds.js` — DALL-E backgrounds to R2
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `generate-passage-backgrounds.js` | Generates child-friendly reading-passage background images per level with DALL-E 3 and uploads them to R2 |
| `get-flow-errors.js` | Fetches detailed validation errors for a WhatsApp Flow from Meta (reading-assessment flow by default) |
| `upload-flow.js` | Uploads a WhatsApp Flow JSON asset to Meta for a given flow id |

## Who reads this (generated)
- env read here: `OPENAI_API_KEY` · `R2_ACCESS_KEY_ID` · `R2_BUCKET_NAME` · `R2_ENDPOINT` · `R2_SECRET_ACCESS_KEY` · `READING_ASSESSMENT_FLOW_ID` · `WHATSAPP_TOKEN`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/scripts/CLAUDE.md`?
