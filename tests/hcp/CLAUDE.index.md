# hcp — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests/hcp -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `_shared.js` | Shared helpers for HCP portal-route tests: jest.doMock plus fake-supabase chain boilerplate for /api/portal/hcp/* |
| `hcp-access-guard.test.js` | bd-6xrimn: /api/portal/hcp/* admits leaders only and each sees only their own patch; teachers refused |
| `hcp-generate-feedback.test.js` | POST /api/portal/hcp/generate-feedback: auth and validation, then six-box coaching feedback JSON from the LLM client |
| `hcp-malformed-json.test.js` | bd-nmwmr4.2: a malformed JSON body returns a 400 JSON, not a 500 template stack; error.ejs and index.js wiring |
| `hcp-schedules-create.test.js` | POST /api/portal/hcp/schedules creates an upcoming visit schedule (FICO/HOTs/COTs) with coach_id from the session |
| `hcp-schedules-list.test.js` | GET /api/portal/hcp/schedules lists only the calling coach's visit schedules, optional status filter |
| `hcp-schedules-update.test.js` | PATCH /api/portal/hcp/schedules/:id updates schedule status (coach UI and teacher WhatsApp button responses) |
| `hcp-teacher-coaching-plan.test.js` | GET /api/portal/hcp/teachers/:id/coaching-plan matches weak indicators to hcp_coaching_actions rows |
| `hcp-teacher-dc.test.js` | GET /api/portal/hcp/teachers/:id/dc returns a teacher's Digital Coach observation history for the DC dashboard |
| `hcp-teacher-detail.test.js` | GET /api/portal/hcp/teachers/:id returns the Priority Dashboard detail payload with a DC summary |
| `hcp-teacher-training.test.js` | GET /api/portal/hcp/teachers/:id/training recommends training modules from the teacher's weak DC indicators |
| `hcp-teachers-list.test.js` | GET /api/portal/hcp/teachers?region= powers the Priority Dashboard teacher list for a region tab |
| `hcp-test-viewer-removed.test.js` | Guards that the unauthenticated /observability/hcp-test-viewer route and view stay deleted from dashboard/index.js |
| `hcp-training-modules-list.test.js` | GET /api/portal/hcp/training-modules lists active training modules a coach can browse or assign |

## Who reads this (all, generated)
- (none)

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `tests/CLAUDE.md`?
