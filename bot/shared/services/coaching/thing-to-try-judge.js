/**
 * v10 coaching test (bd-v0toag.100.8): did this recording show the ask? The ask itself is judged.
 *
 * The old check judged whichever moves shared the ask's practice tag, so an ask in m2/m4 was judged on m1
 * (Quratulain's week-1 review). Now one call reads the ask's text, today's plan moves and the recording's
 * transcript, and answers did / partly / not_done / couldnt_tell, naming the move it judged and quoting the
 * evidence. Anything that cannot be judged is not_graded. Never throws.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const VERDICTS = new Set(['did', 'partly', 'not_done', 'couldnt_tell']);
const TRANSCRIPT_CAP = 30000;
const NOT_GRADED = Object.freeze({ outcome: 'not_graded', moveId: null, evidence: null, why: null });

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function judgePrompt({ thing, moves, transcript }) {
  const plan = moves.map((m) => `- ${m.move_id} [${m.phase || '?'}] ${m.text || ''} (grader: ${m.verdict || '?'})`).join('\n');
  return `You check one coaching ask against a classroom recording.

The teacher was asked to try this in her lessons:
"${thing.text}"

Today's lesson plan moves (id [phase] text (the grader's verdict on the move)):
${plan}

Transcript of today's lesson (may be in Urdu or English):
"""
${String(transcript).slice(0, TRANSCRIPT_CAP)}
"""

Did the teacher do the ask in this lesson? Judge the ask itself, wherever in the lesson it happened,
not just a move that looks similar. Answer:
- "did": she clearly did it.
- "partly": she started it or did part of it.
- "not_done": the lesson had a place for it and she did not do it.
- "couldnt_tell": the transcript does not let you tell.

Reply with JSON only:
{"verdict": "did|partly|not_done|couldnt_tell", "move_id": "<the plan move where it happened or should have, or null>",
 "evidence": "<a short quote from the transcript, in its original language, or null>", "why": "<one English sentence>"}`;
}

function readVerdict(result, moves) {
  if (!result || typeof result !== 'object' || !VERDICTS.has(result.verdict)) return { ...NOT_GRADED };
  const ids = new Set((moves || []).map((m) => m && m.move_id).filter(Boolean));
  return {
    outcome: result.verdict,
    moveId: ids.has(result.move_id) ? result.move_id : null,
    evidence: text(result.evidence),
    why: text(result.why),
  };
}

async function judgeThing({ thing, lpFidelity, sessionId }) {
  try {
    if (!thing || !text(thing.text)) return { ...NOT_GRADED };
    if (!lpFidelity || lpFidelity.status !== 'ok' || !Array.isArray(lpFidelity.moves)) return { ...NOT_GRADED };
    const moves = lpFidelity.moves.filter((m) => m && typeof m === 'object');
    const { data, error } = await supabase
      .from('coaching_sessions').select('transcript_text').eq('id', sessionId).maybeSingle();
    const transcript = !error && data ? text(data.transcript_text) : null;
    if (!transcript) return { ...NOT_GRADED };
    const llm = require('../gpt5-mini.service');
    const { result } = await llm.completeJson(judgePrompt({ thing, moves, transcript }), {
      label: 'thing-to-try-judge', maxTokens: 800,
    });
    return readVerdict(result, moves);
  } catch (err) {
    logToFile('v10 test: thing to try judge failed (not_graded)', { sessionId, error: err.message });
    return { ...NOT_GRADED };
  }
}

module.exports = { VERDICTS, TRANSCRIPT_CAP, judgePrompt, readVerdict, judgeThing };
