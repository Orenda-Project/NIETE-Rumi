# fidelity — full index (generated)

<!-- kg:index repo=NIETE-Rumi dir=tests/coaching/fidelity -->
Every row the door could not hold, ungrouped. Not auto-loaded; same hop as `CLAUDE.md`.

## Children (all, generated)
| path | purpose |
|---|---|
| `CLAUDE.index.md` | (unmapped) |
| `CLAUDE.md` | (unmapped) |
| `corpus-ref-carries-subject.test.js` | resolveCorpusRef carries the subject and grade encoded in the lesson_id through to the fidelity meta (orchestrator) |
| `fico-section-b-fidelity.test.js` | P4.1 (bd-wmfsp.9): applyLpFidelity derives FICO Section B marks from measured fidelity_pct and recomputes overall |
| `fidelity-analyzer-empty-retry-effort.test.js` | bd-29r3o: an empty grader answer is retried at the same reasoning effort and the retry marker is stored on the blob |
| `fidelity-analyzer-v2.test.js` | bd-b3pop.11/.15: grader call knobs, photo evidence in its data boundary, retry then report untrustworthy gradings |
| `fidelity-analyzer.test.js` | P3.1: fidelity LLM grader call shape and parsing with the model mocked; grader never sees the deterministic bucket |
| `fidelity-orchestrator-unusable-guard.test.js` | bd-b3pop.31: a transcript with no [MM:SS] stamps is marked not scored in code before any model call |
| `fidelity-orchestrator-v2.test.js` | bd-b3pop.8/.12/.15: orchestrator wiring through real scorer, pre-flight, photo normaliser and credit guard |
| `fidelity-orchestrator.test.js` | P3.3: orchestrator resolves corpus or uploaded move-list, grades, scores, builds the persist blob; never blocking |
| `fidelity-preflight.test.js` | bd-b3pop.5: pure pre-flight counts transcript timestamps and where it stops against audio length (fidelity-preflight) |
| `fidelity-recompute-v2-inputs.test.js` | bd-b3pop.9: late-LP recompute loader selects audio duration and passes stored photo evidence to the grader |
| `fidelity-recompute.test.js` | bd-5knlj: recomputeFidelityForSession re-grades when a plan arrives after analysis; refuses a submitted review |
| `fidelity-report-block.test.js` | P4.2: extractFidelity maps the measured lp_fidelity blob to the report block: pct, band, phase bar, verdicts |
| `fidelity-scorer.test.js` | P3.2: deterministic fidelity scorer, credit map and bounds, no LLM (fidelity-scorer, ported from eval scorer.py) |
| `grader-photo-evidence.test.js` | bd-b3pop.15: pinned photo-evidence rules and per-photo block inside a data boundary for the fidelity grader |
| `grader-prompt-substitution-calibration.test.js` | bd-xkq6q: grader prompt rules calibrating substitution verdicts so different-content moves are not scored not_done |
| `lp-corpus-linker.test.js` | P2: resolveCorpusRef maps asset_id to version keys; buildLPSelectionList renders the rich enriched-LP label |
| `lp-fidelity-store.test.js` | P1.2: move-list store resolves the exact downloaded lesson version (bd-wmfsp.3), null on unknown, DB mocked |
| `lp-selection-format.test.js` | P2: formatLpRow builds the LP-selection row label: topic headline plus chapter, day, pages and recency line |
| `lp-selection-rowcap.test.js` | bd-zrlcp: the LP selection list never exceeds WhatsApp's row cap, so 9+ recent plans still deliver |
| `lp-upload-extractor.test.js` | P1.3: uploaded-LP extractor with LLM mocked: image-only PDF fails loud, tags normalised for grader parity |
| `orchestrator-robustness.test.js` | bd-5knlj: fidelity orchestrator falls back to the current move-list on version drift and retries transient failures |
| `photo-credit-guard.test.js` | bd-b3pop F1: code caps full credit that rests only on a photo lacking the move's own content (photo-credit-guard) |
| `recent-fidelity-lps-app-opens.test.js` | Recent plans list also includes plans read in the app, deduped by lesson at newest use (recent-fidelity-lps.service) |
| `recent-fidelity-lps.test.js` | P2: recent-LP source for the coaching list reads niete_lp_downloads, dedups by lesson_id, enriches from V8 catalog |
| `resolve-fidelity-sources.test.js` | bd-dflr7: resolveFidelitySources chooses corpus key or uploaded text without gating on lesson_plan_link_method |
| `section-b-backfill-v2-inputs.test.js` | bd-b3pop.9: Section B backfill re-grade passes stored audio length and photo evidence (section-b-backfill.service) |
| `truncation-inconsistent.test.js` | claimsTruncation flags a grader that says the recording ended early yet scores later moves missed; scores unchanged |

## Who reads this (all, generated)
- env `LP_FIDELITY_RUNS` read at `tests/coaching/fidelity/fidelity-analyzer-empty-retry-effort.test.js:127:2d13491e` · `tests/coaching/fidelity/fidelity-orchestrator-unusable-guard.test.js:29:2d13491e`

## Tests (all, generated)
- (none)

## Related (all, generated)
- docs: `bot/shared/services/coaching/fidelity/CLAUDE.index.md`? · `bot/shared/services/coaching/fidelity/CLAUDE.md`? · `bot/shared/services/coaching/lp-coaching/CLAUDE.index.md`? · `bot/shared/services/coaching/report-transformers/CLAUDE.index.md`? · `bot/shared/services/coaching/report-transformers/CLAUDE.md`? · `tests/BASELINE.md`? · `tests/CLAUDE.index.md`? · `tests/coaching/CLAUDE.index.md`? · `tests/coaching/CLAUDE.md`? · `tests/coaching/fidelity/CLAUDE.index.md`? · `tests/coaching/fidelity/CLAUDE.md`?
