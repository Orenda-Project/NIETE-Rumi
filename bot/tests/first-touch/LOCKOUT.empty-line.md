# The empty /quiz line — every cell names one reply (no cell is stuck)

Sender: a teacher the bot already knows (registered, or a teacher by activity), typing "quiz" / «کوئز» / `/quiz`, or
tapping the menu's quiz row. The door never runs for this sender (its verdict is not `unknown`); this table is the
whole of what `showList()` does on that turn. Executed by `maker-empty.golden.test.js` and `maker-fallback.test.js`.

| Lessons | `quiz_maker_page` | Ledger for `maker_reply` | cta_url send | Reply (count) | `onboard.quiz_door.reply` | Way out |
|---|---|---|---|---|---|---|
| ≥ 1 | off / on | — | — | today's list / Flow (1), byte-identical | — (not emitted) | today's |
| 0 | off | — | — | today's `tqListEmptyPlans` / `tqListEmpty` (1), byte-identical | — | today's |
| 0 | on | refused (not yet a trigger, or over the per-phone cap) | — | today's empty string, unledgered (1) | `today` | today's |
| 0 | on | allowed | sent | `maker.empty.body` + `maker.empty.btn` → `/m/<token>` (`via:'empty'`) (1) | `maker` | the page; or type any word as today |
| 0 | on | allowed | refused | `maker.fallback.body.known` + 3 buttons `ft_fb_quiz` / `ft_fb_lp` / `ft_fb_coach` (1, same ledger row) | `fallback` | each button opens today's entry (Student Videos, lesson-plan browse, coaching) |
| 0 | on | the module throws at require | — | today's empty string (1) | — | today's |

`transcript_quiz.list_empty { userId }` fires exactly once on every no-lesson row. Stuck cells: 0. Cells that change
today's reply only with the switch ON: rows 4 and 5.
