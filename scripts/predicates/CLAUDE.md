# predicates — Reviewed SQL predicates that select accounts for bulk flagging

<!-- kg:meta repo=NIETE-Rumi dir=scripts/predicates kg=31066f8af5d0 gen=4267b2c2f77e overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `test-users.sql` — rules feeding mark-test-users.py; reviewed before every run
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `test-users.sql` | Reviewed SQL predicate returning (id, rule) of accounts mark-test-users.py flags; never selects coaches via school rules |

## Who reads this (generated)
- (none)

## Never (human)
- Write the coach guard as role <> 'coach': it drops NULL roles; keep IS DISTINCT FROM (test-users.sql:12)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- (none)

## Related (generated)
- docs: `scripts/CLAUDE.md`?
