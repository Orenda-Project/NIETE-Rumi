# registration — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests/registration -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `after-first-feature-invite.test.js` | Pins that after a delivered feature an unregistered adult gets the registration Flow once, via the one invite sender |
| `bd-oak77-6-completion-sets-flag.test.js` | bd-oak77.6: a terminal SUCCESS screen from the registration endpoint writes registration_completed=true |
| `bd-oak77-6-named-user-is-registered.test.js` | bd-oak77.6: a user with a name but registration_completed=false counts as registered; /register offers update copy |
| `bd-x7aprz2-flow-v5-json.test.js` | bd-x7aprz.2: static checks of registration-flow-v5.1.json (five forward-only screens, bindings, SUCCESS terminal) |
| `bd-x7aprz2-registration-v5.test.js` | bd-x7aprz.2 and bd-3goqc0: registration v5 endpoint grants teacher or principal only, never alters coach or AEO |
| `bd-x7aprz9-finish-closes-flow.test.js` | bd-x7aprz.9 (P0): Finish on the v5 registration Flow returns a completion payload so the Flow closes |
| `bd-z8p96-completion-does-not-overwrite-sector.test.js` | bd-z8p96: terminal registration write leaves users.region to the REGION_INFO screen, not the province dropdown |
| `bd-z8p96-region-screen-links-school-by-emis.test.js` | bd-z8p96: REGION_INFO links users.school_id and sector from the typed EMIS code; unknown EMIS logs and keeps province |
| `flow-type-detector.test.js` | Pins detectFlowType, the nfm_reply router that picks the handler for each completed WhatsApp Flow |
| `front-door-invite.test.js` | Pins the front door: any unregistered adult or register request reaches the registration Flow via one invite sender |
| `greeting-only.test.js` | Pins isGreetingOnly so a bare "hi" gets the registration invite and not a second AI greeting |
| `name-capture-rejects-commands.test.js` | Pins extractFirstName rejecting slash commands, filler and impossible names so chat text is never stored as a name |
| `name-question-voice-gateway.test.js` | Pins that the spoken name question uses the voice gateway and falls back to text when synthesis fails |
| `needs-registration-form.test.js` | Pins the single needsRegistrationForm/needsSchoolForFeature predicate read by unprompted doors in registration-status |
| `registration-asks-language.test.js` | Pins that registration INIT asks language first (Urdu first, preselected, own-script labels) so it is chosen |
| `registration-endpoint.test.js` | Pins registration-endpoint screen routing, BACK navigation and Redis persistence of the registration Flow |
| `registration-flow-gate.test.js` | Pins that sendNameQuestion opens the registration Flow when REGISTRATION_FLOW_ID is set, else asks the name in chat |
| `registration-intent.test.js` | Pins isRegistrationIntent: real production phrasings of "register" open the Flow, non-requests do not |
| `registration-invite.service.test.js` | Pins registration-invite.service, the one sender of the registration Flow: token, language copy, once-only offer |

## Who reads this (all, generated)
- env `INTERNAL_API_KEY` read at `tests/registration/bd-x7aprz2-registration-v5.test.js:307:a4ce414a`
- env `REGISTRATION_FLOW_ID` read at `tests/registration/after-first-feature-invite.test.js:36:d6ab9f5f` · `tests/registration/registration-flow-gate.test.js:8:d6ab9f5f` · `tests/registration/registration-invite.service.test.js:70:d6ab9f5f`
- env `SUPABASE_URL` read at `tests/registration/bd-x7aprz2-registration-v5.test.js:307:a4ce414a`

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/scripts/setup/CLAUDE.index.md`? · `bot/shared/config/CLAUDE.index.md`? · `bot/shared/handlers/CLAUDE.index.md`? · `bot/shared/routes/CLAUDE.index.md`? · `bot/shared/services/CLAUDE.index.md`? · `bot/shared/services/classes/CLAUDE.index.md`? · `bot/shared/services/schools/CLAUDE.md`? · `bot/shared/utils/CLAUDE.index.md`? · `tests/CLAUDE.index.md`? · `tests/CLAUDE.md`? · `tests/registration/CLAUDE.index.md`? · `tests/registration/CLAUDE.md`?
