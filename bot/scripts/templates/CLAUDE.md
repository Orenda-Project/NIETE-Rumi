# templates — Menu carousel template creation and video upload; WABA-bound ids

<!-- kg:meta repo=NIETE-Rumi dir=bot/scripts/templates kg=bb1e047a2b9b gen=2fed5feed03a overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `README.md` — which files carry WABA-specific handles
- `create-menu-carousel-v3.js` — 4-card template
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `README.md` | Warns these carousel template scripts and JSON are tied to the original WABA's media handles and template ids |
| `create-menu-carousel-v3.js` | Creates the 4-card feature_menu_carousel_v3 template (lesson plans, video, coaching, reading) from uploaded video handl… |
| `create-menu-carousel.js` | Creates the original video-header feature menu carousel template used by /menu |
| `menu-carousel-template-info.json` | Recorded Meta id, PENDING status and staging environment of feature_menu_carousel_v2 submitted Dec 2025 |
| `menu-carousel-template-v3-info.json` | Recorded Meta id, PENDING status, staging env and card list of feature_menu_carousel_v3 submitted Dec 2025 |
| `menu-video-media-ids-v3.json` | Holds upload handles for the v3 menu carousel header videos (lesson plan, video, coaching, reading); WABA-bound |
| `menu-video-media-ids.json` | Holds upload handles for the v2 menu carousel header videos (lesson plan, coaching, reading); WABA-bound |
| `upload-menu-videos-v3.js` | Uploads the four v3 menu videos via Meta's Resumable Upload API to get header handles for template creation |
| `upload-menu-videos.js` | Uploads the three menu intro videos via Resumable Upload API to get header handles for the carousel template |

## Who reads this (generated)
- env read here: `META_APP_ID` · `META_APP_ID_STAGING` · `PHONE_NUMBER_ID` · `STAGING` · `STAGING_WABA_ID` · `WABA_ID` · `WHATSAPP_TOKEN`

## Never (human)
- Media handles and template ids are tied to the original WABA, not NIETE's (README.md:5)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/scripts/CLAUDE.md`? · `bot/scripts/setup/CLAUDE.md`? · `bot/scripts/setup/assets/README.md`? · `bot/scripts/templates/README.md`?
