/**
 * bd-2670 — observeDebriefNotes maxTokens must give Urdu debriefs enough
 * headroom.
 *
 * Why this test exists: on 2026-08-20 the niete-logs Axiom dataset showed a
 * rising trend of `⚠️ observeDebriefNotes: response truncated at
 * max_completion_tokens` — 5→11→28→31/day over the preceding week. The
 * teacher-facing debrief notes for NIETE Urdu sessions were exceeding the
 * historical 2000-token cap, and while `_extractNotes` fails gracefully
 * (returns null; the coaching report still ships), the companion notes
 * teachers were meant to receive were routinely missing.
 *
 * This is a static-source spec: it locks the intent so a future engineer
 * who wants to lower the cap has to update this test and think about why.
 * A raw change-detector on the exact value would drift; the >= 4000 floor
 * captures the ORDER-OF-MAGNITUDE decision (Urdu debrief output is O(4-6K
 * tokens), not O(2K)).
 */

const fs = require('fs');
const path = require('path');

describe('bd-2670 — observeDebriefNotes maxTokens floor', () => {
  const SOURCE = fs.readFileSync(
    path.join(__dirname, '../../shared/services/observe/observe-send.service.js'),
    'utf8'
  );

  test('the observeDebriefNotes call caps maxTokens at >= 4000', () => {
    const match = SOURCE.match(/\{\s*maxTokens:\s*(\d+),\s*label:\s*'observeDebriefNotes'\s*\}/);
    expect(match).toBeTruthy();
    const cap = parseInt(match[1], 10);
    expect(cap).toBeGreaterThanOrEqual(4000);
  });
});
