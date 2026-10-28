# api-health — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=dashboard/services/api-health -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
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
| `supabase.service.js` | Supabase management-API check of database size, disk usage and compute for the API-health page. |
| `uplift.service.js` | Uplift AI TTS usage tracked locally (no public usage API), cached 5 minutes. |
| `whatsapp.service.js` | WhatsApp Cloud API health: messaging limits, quality rating and account status via Graph API. |

## Who reads this (all, generated)
- `api-health-aggregator.service.js` ← imported by `dashboard/routes/api-health.routes.js:8:684e498a`
- `cloudflare-r2.service.js` ← imported by `dashboard/services/api-health/api-health-aggregator.service.js:8:ad5c6512`
- `elevenlabs.service.js` ← imported by `dashboard/services/api-health/api-health-aggregator.service.js:7:5bbab058`
- `openai.service.js` ← imported by `dashboard/services/api-health/api-health-aggregator.service.js:11:af7119ff`
- `railway.service.js` ← imported by `dashboard/services/api-health/api-health-aggregator.service.js:6:0eb140c1`
- `soniox.service.js` ← imported by `dashboard/services/api-health/api-health-aggregator.service.js:12:5b16411f`
- `supabase.service.js` ← imported by `dashboard/services/api-health/api-health-aggregator.service.js:9:fc22ce77`
- `uplift.service.js` ← imported by `dashboard/services/api-health/api-health-aggregator.service.js:13:e13328f7`
- `whatsapp.service.js` ← imported by `dashboard/services/api-health/api-health-aggregator.service.js:10:8c2c3a22`
- column `api_usage_log.estimated_cost` (written by `soniox.service.js`, `uplift.service.js`) ← read by `dashboard/services/api-health/soniox.service.js:45:d8d3ca8f` · `dashboard/services/api-health/uplift.service.js:45:d8d3ca8f`
- column `api_usage_log.service` (written by `soniox.service.js`, `uplift.service.js`) ← read by `dashboard/services/api-health/soniox.service.js:46:637ddbd5` · `dashboard/services/api-health/uplift.service.js:46:c18825f7`
- column `api_usage_log.units_consumed` (written by `soniox.service.js`, `uplift.service.js`) ← read by `dashboard/services/api-health/soniox.service.js:45:d8d3ca8f` · `dashboard/services/api-health/uplift.service.js:45:d8d3ca8f`
- table `api_usage_log` (written by `soniox.service.js`, `uplift.service.js`) ← read by `dashboard/services/api-health/soniox.service.js:44:a681bcd2`? · `dashboard/services/api-health/uplift.service.js:44:a681bcd2`?
- env `CLOUDFLARE_ACCOUNT_ID` read at `dashboard/services/api-health/cloudflare-r2.service.js:35:43e98e09`
- env `CLOUDFLARE_API_TOKEN` read at `dashboard/services/api-health/cloudflare-r2.service.js:39:a76a9164`
- env `CLOUDFLARE_R2_ACCESS_KEY_ID` read at `dashboard/services/api-health/cloudflare-r2.service.js:36:c7982365`
- env `CLOUDFLARE_R2_BUCKET_NAME` read at `dashboard/services/api-health/cloudflare-r2.service.js:38:29c9e88b`
- env `CLOUDFLARE_R2_SECRET_ACCESS_KEY` read at `dashboard/services/api-health/cloudflare-r2.service.js:37:ca66be09`
- env `ELEVENLABS_API_KEY` read at `dashboard/services/api-health/elevenlabs.service.js:25:8162432c`
- env `GRAPH_API_VERSION` read at `dashboard/services/api-health/whatsapp.service.js:8:ddcada1f`
- env `OPENAI_API_KEY` read at `dashboard/services/api-health/openai.service.js:25:206dad27`
- env `PHONE_NUMBER_ID` read at `dashboard/services/api-health/whatsapp.service.js:28:1c9a3ecb`
- env `RAILWAY_ACCOUNT_TOKEN` read at `dashboard/services/api-health/railway.service.js:26:294ad86d`
- env `RAILWAY_API_TOKEN` read at `dashboard/services/api-health/railway.service.js:26:294ad86d`
- env `SUPABASE_ACCESS_TOKEN` read at `dashboard/services/api-health/supabase.service.js:25:624e5ebd`
- env `SUPABASE_PROJECT_REF` read at `dashboard/services/api-health/supabase.service.js:26:13ea365d`
- env `WABA_ID` read at `dashboard/services/api-health/whatsapp.service.js:28:1c9a3ecb`
- env `WHATSAPP_TOKEN` read at `dashboard/services/api-health/whatsapp.service.js:26:250e68a3`

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `dashboard/services/CLAUDE.index.md`? · `dashboard/services/CLAUDE.md`? · `dashboard/services/api-health/CLAUDE.index.md`? · `dashboard/services/api-health/CLAUDE.md`?
