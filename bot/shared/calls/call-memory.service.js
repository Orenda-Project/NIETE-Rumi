'use strict';
/**
 * Post-call memory (bd-neeyat) — the WRITE side that matches Noor.
 *
 * After a call ends, fold its transcript into the caller's bounded rolling
 * summary in `call_memory`, so the NEXT call's "PREVIOUS CALLS WITH HER" block
 * (already assembled by call-context) is actually populated. Previously that
 * table was only ever read, so calls never built any memory.
 *
 * Runs off the call path (fire-and-forget from onCallEnd) and NEVER throws to
 * the caller. The LLM is injectable so the whole thing is unit-testable with no
 * network, matching the rest of the calls module.
 */

const MAX_MEMORY_CHARS = 1200;
// A 5-minute call is ~4-6k chars. The cap is a backstop against a pathological
// transcript becoming a pathological bill, not a normal-path trim.
const MAX_TRANSCRIPT_CHARS = 16000;
const DEFAULT_MODEL = process.env.CALLS_MEMORY_MODEL || 'gpt-4o-mini';

/**
 * Render the transcript the ENGINE hands us into text the summariser can read.
 *
 * `onCallEnd` passes `CallSession.getTranscript()` — an ARRAY of
 * {role,text,at}, never a string. Interpolating that array directly yields
 * "[object Object],[object Object]", which is non-empty, so it sails past every
 * guard and gets summarised into HER NEXT CALL's prompt. That is the same
 * defect class as the bd-1hae7.6 `focus_area`/`strengths[]` objects, and it is
 * why this function exists rather than a template literal.
 *
 * Accepts a plain string too, so a caller that already has text still works.
 *
 * @returns {string} '' when there is nothing worth summarising.
 */
function formatTranscript(transcript) {
  if (!transcript) return '';

  let text;
  if (typeof transcript === 'string') {
    text = transcript;
  } else if (Array.isArray(transcript)) {
    text = transcript
      .map((line) => {
        if (!line) return '';
        if (typeof line === 'string') return line.trim();
        const said = String(line.text || '').trim();
        if (!said) return '';
        const who = line.role === 'assistant' ? 'Neeyat' : 'Caller';
        return `${who}: ${said}`;
      })
      .filter(Boolean)
      .join('\n');
  } else {
    return '';
  }

  text = text.trim();
  if (!text) return '';
  // Keep the END of a long call: commitments and follow-ups land there.
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    text = `…\n${text.slice(-MAX_TRANSCRIPT_CHARS)}`;
  }
  return text;
}

const SYSTEM_PROMPT = `You maintain a concise, durable MEMORY of a NIETE teacher/coach's past PHONE CALLS with the assistant "Neeyat".
You are given the EXISTING MEMORY and the LATEST CALL TRANSCRIPT. Output an UPDATED memory that MERGES them.
Keep only durable, reusable facts: who she is (teacher or coach/AEO, grade/subject/school if stated), what she keeps asking about, any decisions or commitments made, and open follow-ups for next time.
Drop greetings, small talk and one-off chatter. Terse bullet points.
HARD LIMIT ${MAX_MEMORY_CHARS} characters. If over, keep the most durable facts and drop the rest.
Output ONLY the updated memory text — no preamble.`;

/** Default LLM: their `openai` client + a cheap model. Injectable for tests. */
async function defaultLlm({ system, user, apiKey, model }) {
  // eslint-disable-next-line global-require
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey });
  const r = await client.chat.completions.create({
    model,
    temperature: 0.2,
    max_tokens: 500,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  return (r && r.choices && r.choices[0] && r.choices[0].message
    && r.choices[0].message.content
    ? r.choices[0].message.content.trim()
    : '');
}

/**
 * @param {object}   deps
 * @param {object}   deps.repo     { fetchMemory, upsertMemory }
 * @param {string}   deps.apiKey
 * @param {object}   [deps.logger]
 * @param {Function} [deps.llm]    ({system,user,apiKey,model}) => Promise<string>
 * @param {string}   [deps.model]
 * @returns {(args:{callerNumber:string, transcript:string}) => Promise<void>}
 */
function createMemoryWriter({ repo, apiKey, logger, llm = defaultLlm, model = DEFAULT_MODEL }) {
  const log = logger || { info: () => {}, warn: () => {} };

  return async function summarizeAndStore({ callerNumber, transcript }) {
    if (!callerNumber) return;
    const transcriptText = formatTranscript(transcript);
    // A call with no words in it has nothing to remember — and must not bill an
    // LLM call to discover that.
    if (!transcriptText) return;
    try {
      let existingSummary = '(none yet)';
      let callCount = 1;
      try {
        const prev = await repo.fetchMemory(callerNumber);
        if (prev) {
          if (prev.summary) existingSummary = prev.summary;
          callCount = (Number(prev.call_count) || 0) + 1;
        }
      } catch (err) {
        // A missing/broken table must not lose this call's memory attempt.
        log.warn('[calls] memory read failed (continuing)', { error: err.message });
      }

      let summary = await llm({
        system: SYSTEM_PROMPT,
        user: `EXISTING MEMORY:\n${existingSummary}\n\nLATEST CALL TRANSCRIPT:\n${transcriptText}`,
        apiKey,
        model,
      });
      if (!summary || !summary.trim()) return;
      if (summary.length > MAX_MEMORY_CHARS) summary = `${summary.slice(0, MAX_MEMORY_CHARS)}…`;

      await repo.upsertMemory(callerNumber, { summary, callCount });
      log.info('[calls] call memory updated', {
        caller: `${String(callerNumber).slice(0, 4)}****`, chars: summary.length, callCount,
      });
    } catch (err) {
      log.warn('[calls] memory summarize failed', { error: err.message });
    }
  };
}

module.exports = {
  createMemoryWriter, defaultLlm, formatTranscript, MAX_MEMORY_CHARS, MAX_TRANSCRIPT_CHARS,
};
