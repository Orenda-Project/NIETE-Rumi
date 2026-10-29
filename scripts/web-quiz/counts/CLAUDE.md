# counts — Read-only sandbox counts of what web-quiz surfaces serve

<!-- kg:meta repo=NIETE-Rumi dir=scripts/web-quiz/counts kg=ba2bee17b658 gen=8fc40bd19298 overflow=0 rendered=2026-10-29 kg.py=1.1.0 -->

## Entry points
- `web_quiz_videos_v3.js` — video library off vs on, per grade and subject
- `web_quiz_stories.js` — storybook shelf counts
<!-- read: map-read-niete-bot 2026-10-29 -->

## Children (generated)
| path | purpose |
|---|---|
| `web_quiz_next_offer.js` | Read-only count of what the ranked Next tile can offer the smallest-served children, switch forced on in-process |
| `web_quiz_stories.js` | Read-only per-grade-and-language counts of what the storybook shelf serves, never titles or ids |
| `web_quiz_videos_v3.js` | Read-only per-grade-and-subject count of the video library with web_quiz_videos_v3 off vs on; refuses non-sandbox |

## Who reads this (generated)
- (none)

## Never (human)
- Emit an id or a title: counts only, refuses non-sandbox (web_quiz_videos_v3.js:9-12)
<!-- read: map-read-niete-bot 2026-10-29 -->

## Tests (generated)
- `bot/tests/quiz/web-quiz/web-quiz-next-offer-counts.test.js` (web_quiz_next_offer.js)
- `bot/tests/quiz/web-quiz/web-quiz-stories-count.test.js` (web_quiz_stories.js)
- `bot/tests/quiz/web-quiz/web-quiz-videos-v3-counts.test.js` (web_quiz_videos_v3.js)

## Related (generated)
- docs: `scripts/web-quiz/CLAUDE.md`?
