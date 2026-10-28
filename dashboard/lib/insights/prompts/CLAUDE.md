# prompts — Model prompts for COACHIP glosses, re-check, homework and phonics detection

<!-- kg:meta repo=NIETE-Rumi dir=dashboard/lib/insights/prompts kg=82a9a3958a25 gen=562ef702529a overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `gloss_v2.md` — the clip caption prompt
- `phonics_v2.md` — phonics detector prompt
<!-- read: map-read-niete-portal 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.md` | (unmapped) |
| `gloss_recheck_v1.md` | Prompt for the Opus judge that re-checks a clip caption's quality (5% re-check); rows stored with purpose=recheck. |
| `gloss_v2.md` | Model prompt writing a one-line caption for a short classroom audio clip for a coach's debrief; copied from x-analysis. |
| `homework_v1.md` | Model prompt judging from grader notes whether in-class independent practice was replaced by homework. |
| `phonics_v2.md` | Model prompt for the phonics detector: names stages with quotes from a timestamped transcript; code verifies quotes. |

## Who reads this (generated)
- (none)

## Never (human)
- Never edit these copies first; edit in x-analysis and bump the version (`gloss_v2.md:1`)
<!-- read: map-read-niete-portal 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `dashboard/lib/insights/CLAUDE.index.md`? · `dashboard/lib/insights/CLAUDE.md`? · `dashboard/lib/insights/prompts/CLAUDE.md`? · `dashboard/lib/insights/prompts/gloss_recheck_v1.md`? · `dashboard/lib/insights/prompts/gloss_v2.md`? · `dashboard/lib/insights/prompts/homework_v1.md`? (+1)
