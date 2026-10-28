# api-health — One module per vendor for the API-health admin page, aggregated
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=dashboard/services/api-health kg=7bfee8f8fb94 gen=98371fc3eb07 overflow=14 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `api-health-aggregator.service.js` — combines all vendor checks
- `railway.service.js` — example vendor check with 5-minute cache
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `api-health-aggregator.service.js` | Combines the per-vendor health services (Railway, ElevenLabs, R2, Supabase, WhatsApp, OpenAI, Soniox, Uplift). |
| `cloudflare-r2.service.js` | Cloudflare R2 storage usage/health check for the API-health page with a 5-minute cache. |
| `elevenlabs.service.js` | ElevenLabs character usage and subscription-limit health check, cached 5 minutes. |
| `openai.service.js` | OpenAI usage, billing and credit-grant health check, cached 5 minutes. |
| `railway.service.js` | Railway GraphQL usage, billing and project metrics for the API-health page, cached 5 minutes. |
| `soniox.service.js` | Soniox transcription usage tracked locally (no usage API) via api_usage_log, cached 5 minutes. |
| … | 3 more → `CLAUDE.index.md` |

## Who reads this (generated)
- column `api_usage_log.estimated_cost` (written by `soniox.service.js` (+1)) ← read by `dashboard/services/api-health/soniox.service.js:45:d8d3ca8f` · `dashboard/services/api-health/uplift.service.js:45:d8d3ca8f`
- column `api_usage_log.service` (written by `soniox.service.js` (+1)) ← read by `dashboard/services/api-health/soniox.service.js:46:637ddbd5` · `dashboard/services/api-health/uplift.service.js:46:c18825f7`
- column `api_usage_log.units_consumed` (written by `soniox.service.js` (+1)) ← read by `dashboard/services/api-health/soniox.service.js:45:d8d3ca8f` · `dashboard/services/api-health/uplift.service.js:45:d8d3ca8f`
- … 11 more → `CLAUDE.index.md`

## Never (human)
_None found in code comments, tests or git log for this directory._
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `dashboard/services/CLAUDE.index.md`? · `dashboard/services/CLAUDE.md`? · `dashboard/services/api-health/CLAUDE.index.md`? · `dashboard/services/api-health/CLAUDE.md`?
