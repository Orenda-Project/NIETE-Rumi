# templates — WhatsApp message template JSON per WABA, plus submit and re-upload scripts
Full index: `CLAUDE.index.md`

<!-- kg:meta repo=NIETE-Rumi dir=infrastructure/templates kg=3885ea2b9351 gen=a135a5d5fce7 overflow=4 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `README.md` — which templates were harvested, submitted or skipped, and why
- `publish-templates.sh` — submits every top-level *.json to the NIETE WABA
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `drafts/` | Unsubmitted utility template drafts for the teacher-app ready fallback → `drafts/CLAUDE.md` |
| `share/` | Four 'Send on WhatsApp' share templates (en and ur) used by the teacher app → `share/CLAUDE.md` |
| `README.md` | Explains NIETE WhatsApp templates harvested from the PK WABA, per-WABA resubmission and submission status (July 2026) |
| `publish-templates.sh` | Shell script that submits every top-level template JSON in this folder to the NIETE WABA via the Graph API |
| `feature_menu_carousel_v3.json` | MARKETING carousel template (video cards) advertising the feature menu, submitted to the NIETE WABA |
| `message_templates_readingtest_v2_marketing_e4c46.json` | Harvested MARKETING copy of the reading-test invitation template under its Meta-generated name |
| `quiz_invitation_en.json` | English UTILITY template inviting a child/parent to a quiz; approved on the NIETE WABA |
| `quiz_invitation_ur.json` | Urdu UTILITY template inviting a child/parent to a quiz; approved on the NIETE WABA |
| `readingtest_v2.json` | English MARKETING template inviting teachers to run a reading test; approved on the NIETE WABA |
| `registration_v3.json` | English MARKETING registration invitation template harvested from PK; skipped for the NIETE launch |
| … | 4 more → `CLAUDE.index.md` |

## Who reads this (generated)
- env read here: `DRY_RUN` · `NIETE_WABA_ID` · `NIETE_WHATSAPP_TOKEN` · `PREFIX`

## Never (human)
- Templates are per-WABA; PK's media header handles do not work on NIETE (reupload-carousel-media.py:6, README.md:5)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `docs/migration/DEPLOYMENT.md`? · `infrastructure/CLAUDE.md`? · `infrastructure/templates/README.md`? · `infrastructure/templates/drafts/CLAUDE.md`? · `infrastructure/templates/drafts/README.md`? · `infrastructure/templates/share/CLAUDE.md`? (+1)
