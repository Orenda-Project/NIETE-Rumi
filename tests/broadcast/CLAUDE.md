# broadcast — Dashboard WhatsApp broadcast sending: templates, language, wamids, quick-reply taps

<!-- kg:meta repo=NIETE-Rumi dir=tests/broadcast kg=c5eea2be0611 gen=79ced0f8291e overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `bd-1zyqf-broadcast-language.test.js` — each teacher gets their preferred_language variant
- `bd-djbrt-direct-send-records-wamid.test.js` — wamid recording so status webhooks can match
- Root jest over bot/ code; run from repo root: `node tests/run.js tests/broadcast --maxWorkers=2`
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `bd-07cjd-hos-video-buttons.test.js` | bd-07cjd: head-of-school broadcast quick-reply taps ("Lesson Plans video", "Teacher Training video") reply with video |
| `bd-1zyqf-broadcast-language.test.js` | bd-1zyqf: whatsapp-broadcast.service sends each teacher the template in their preferred_language, not hardcoded en |
| `bd-djbrt-direct-send-records-wamid.test.js` | bd-djbrt: direct (non-template) broadcast records the wamid for status webhooks; record failure is not a send failure |
| `CLAUDE.md` | (unmapped) |
| `bd-x4njf-approved-template.test.js` | bd-x4njf: broadcast can run on an already-approved WABA template, reading its real variant languages from Meta |
| `bd-ikkpf-search-mode-registration-flag.test.js` | bd-ikkpf: getUsersForBroadcast search mode does not re-filter chosen ids on registration_completed, still needs a phone |
| `bd-nnco2-fde-notification-button.test.js` | bd-nnco2: the DC-intro broadcast's "View notification" button sends the tracked FDE authorization PDF |

## Who reads this (generated)
- env read here: `HOS_VIDEO_LP_URL` · `HOS_VIDEO_TRAINING_URL`

## Never (human)
- Direct sends must record the wamid (bd-djbrt: a 501-teacher launch recorded none, tests/broadcast/bd-djbrt-direct-send-records-wamid.test.js:2)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `bot/shared/handlers/CLAUDE.index.md`? · `bot/shared/utils/CLAUDE.index.md`? · `dashboard/database/CLAUDE.index.md`? · `dashboard/database/CLAUDE.md`? · `dashboard/services/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? (+2)
