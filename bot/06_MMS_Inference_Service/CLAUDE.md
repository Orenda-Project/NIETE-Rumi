# 06_MMS_Inference_Service — Standalone Python ASR service for Balochi, Sindhi, Pashto speech (bot calls it over HTTP)

<!-- kg:meta repo=NIETE-Rumi dir=bot/06_MMS_Inference_Service kg=8b3ff86c79dc gen=80caedd33f0b overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `app/main.py` — FastAPI /asr, /health, /languages around MMS-1b-all
- `modal_app.py` — serverless GPU variant with API-key auth
- `railway.json` — deploy settings
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `app/` | → (no door; 1 files) |
| `modal_app.py` | Modal.com serverless T4-GPU deployment of MMS-ASR with API-key auth and a lock serialising language adapters |
| `railway.json` | Railway deploy config for the MMS service: Dockerfile build, python -m app.main start, /health check |
| `Dockerfile` | Builds the MMS-ASR FastAPI image (python 3.11, ffmpeg, libsndfile) for the Pakistani regional-language ASR service |
| `requirements.txt` | Pinned Python deps (fastapi, transformers, torch, librosa) for the MMS inference service |

## Who reads this (generated)
- env read here: `MMS_API_KEY`

## Never (human)
- Keep the language-adapter lock: one MMS adapter loads at a time (modal_app.py header)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/CLAUDE.md`?
