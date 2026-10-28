# predicates — Reviewed SQL predicates that select accounts for bulk flagging

<!-- kg:meta repo=NIETE-Rumi dir=scripts/predicates kg=31066f8af5d0 gen=a4db269da949 overflow=0 rendered=2026-10-28 kg.py=1.0.0 -->

## Entry points
- `test-users.sql` — rules feeding mark-test-users.py; reviewed before every run
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `CLAUDE.md` | (unmapped) |
| `test-users.sql` | Reviewed SQL predicate returning (id, rule) of accounts mark-test-users.py flags; never selects coaches via school rules |

## Who reads this (generated)
- (none)

## Never (human)
- Write the coach guard as role <> 'coach': it drops NULL roles; keep IS DISTINCT FROM (test-users.sql:12)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `scripts/CLAUDE.index.md`? · `scripts/CLAUDE.md`? · `scripts/predicates/CLAUDE.md`?
