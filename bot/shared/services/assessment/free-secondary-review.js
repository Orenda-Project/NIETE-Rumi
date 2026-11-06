'use strict';
/**
 * bd-5jmnfj.38.31 — the distractor review of a G6-12 free paper (A7b, and the longest key of A7a).
 * One small model call rates each distractor 1-3 for a student who holds a common misconception and
 * flags a key that is the longest option (the prompt is reviewPrompt in free-secondary-rules.js). A
 * distractor rated 1 becomes a 'weak-distractor' issue and a flagged key a 'longest-key' one, both of
 * which the targeted rewrite takes. No I/O: the service passes the call in as `ask`.
 */

const { items } = require('./free-secondary-checks');
const { keyIndex } = require('./free-secondary-keys');
const { reviewPrompt } = require('./free-secondary-rules');

const LETTERS = ['a', 'b', 'c', 'd'];
const sig = (item) => JSON.stringify([item.question, item.options]);

/** The paper's MCQs, by their paper number, with the key letter. */
function mcqsOf(examJson) {
  return items(examJson).filter((e) => e.isMcq).map((e) => ({
    n: e.n, question: e.item.question, options: e.item.options, key: LETTERS[keyIndex(e.item)] || '?', item: e.item,
  }));
}

/** The issues a review reply raises; a longest key the length check already flagged is not repeated. */
function issuesFrom(reply, examJson, existing = []) {
  const byN = new Map(mcqsOf(examJson).map((m) => [m.n, m]));
  const flagged = new Set((existing || []).filter((i) => i.check === 'longest-key').map((i) => i.n));
  const out = [];
  (Array.isArray(reply && reply.items) ? reply.items : []).forEach((r) => {
    const m = byN.get(Number(r && r.n));
    if (!m) return;
    const weak = (Array.isArray(r.distractors) ? r.distractors : [])
      .filter((d) => d && Number(d.rating) === 1)
      .filter((d) => { const l = String(d.option || '').trim().toLowerCase().charAt(0); return LETTERS.includes(l) && l !== m.key; });
    if (weak.length) {
      const named = weak.map((d) => `${String(d.option).trim().toLowerCase().charAt(0)})${d.why ? ` (${d.why})` : ''}`).join(', ');
      out.push({ n: m.n, check: 'weak-distractor', sig: sig(m.item),
        text: `distractor ${named} would draw no student who half-knows the lesson; replace it with a wrong answer a student with a common misconception would choose` });
    }
    if (r.longest_key === true && !flagged.has(m.n)) {
      out.push({ n: m.n, check: 'longest-key', sig: sig(m.item),
        text: 'the key stands out as the longest or most detailed option; make the four options about the same length and detail' });
    }
  });
  return out;
}

/** The review issues whose item is still as it was reviewed. */
function stillOpen(examJson, issues) {
  const all = items(examJson);
  return (issues || []).filter((i) => all[i.n - 1] && sig(all[i.n - 1].item) === i.sig);
}

/** One review call; `ask` takes the prompt text and resolves to the parsed reply. Never throws. */
async function review({ examJson, grade, ask, existing = [], onError = () => {} }) {
  const mcqs = mcqsOf(examJson);
  if (!mcqs.length) return [];
  try {
    return issuesFrom(await ask(reviewPrompt(mcqs, grade)), examJson, existing);
  } catch (err) {
    onError(err);
    return [];
  }
}

module.exports = { mcqsOf, issuesFrom, stillOpen, review };
