'use strict';
/**
 * The v10 card written on request (bd-rj6w0n.14.16.6). The model gets the same rules the 838 GB cards were
 * written with offline (GB_WORKER_PROMPT.md: the brief, EXIT_GOAL + HOME_TURN on the first pass, the GB rules,
 * the Urdu rules for Urdu, the approved example), the v9 HTML and the moves. The gate's reasons go back for one
 * repair round. A deadline bounds the whole step so the teacher never waits longer than ICT (the caller sends
 * v9 alone when it fires).
 */
const fs = require('fs');
const path = require('path');

const JOB = 'lp.v10card';
const V = path.join(__dirname, '../../../vendor/lp-v10');
const read = (f) => fs.readFileSync(path.join(V, f), 'utf8');
// The brief's last section runs offline build/shot commands; the gate does that here.
const BRIEF = read('CARD_BRIEF.md').split('## Check your own card')[0].trimEnd();
const PARTS = { exitGoal: read('EXIT_GOAL.md'), homeTurn: read('HOME_TURN.md'), gb: read('GB_RULES.md'), urdu: read('URDU_RULES.md') };
const EXAMPLES = { english: read('example_english.card.json'), maths: read('example_maths.card.json') };

let _jsonrepair = null;
try { _jsonrepair = require('jsonrepair').jsonrepair; } catch (_) { /* strict parse fallback */ }
function safeJsonParse(content) {
  const text = String(content).replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  try { return JSON.parse(text); } catch (e) {
    if (!_jsonrepair) throw e;
    return JSON.parse(_jsonrepair(text));
  }
}

function systemPrompt({ subject, lang }) {
  const example = subject === 'Maths' ? EXAMPLES.maths : EXAMPLES.english;
  return [
    'You are a GB v10 card writer: ICT\'s v10 card, written for one Gilgit-Baltistan teaching day. Reply with the card.json only.',
    BRIEF,
    'The two editing passes below are written for a second pass over a finished card; write them in on your first pass.',
    PARTS.exitGoal, PARTS.homeTurn, PARTS.gb,
    lang === 'ur' ? PARTS.urdu : '',
    `The approved example: copy its shape and length${lang === 'ur' ? ', not its language' : ''}.\n${example}`,
  ].filter(Boolean).join('\n\n');
}

// A v9 page embeds its fonts and pictures as base64 (~1.8 MB, ~600k tokens), which the provider refuses with a 400.
// The model reads the lesson without those bytes; the gates and the print still get the full page (attach.js).
const EMBEDDED = /data:[^,)"'\s]+;base64,[A-Za-z0-9+/=]+/g;

function userPrompt({ v9Html, moves, stem }) {
  const lesson = v9Html.replace(EMBEDDED, '');
  return `Day: ${stem}. Set "v9_html": "${stem}.v9.html" and header.minutes 40.\n\nmoves:\n${JSON.stringify(moves)}\n\nv9_html:\n${lesson}`;
}

function fail(code, message, extra) { return Object.assign(new Error(message), { code }, extra); }

async function authorCard({ v9Html, moves, stem, subject, lang, validate, client, model, deadlineMs = 8 * 60 * 1000, maxTokens = 12000 }) {
  const llm = client || require('../llm-client').getClient();
  const useModel = model || require('../../config/model-registry').modelFor(JOB);
  const messages = [
    { role: 'system', content: systemPrompt({ subject, lang }) },
    { role: 'user', content: userPrompt({ v9Html, moves, stem }) },
  ];
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(fail('card_timeout', `v10 card: no card within ${deadlineMs} ms`)), deadlineMs);
  });
  const work = async () => {
    let reasons = [];
    for (let round = 1; round <= 2; round++) {
      const response = await llm.chat.completions.create({
        model: useModel, job: JOB, temperature: 0, messages: [...messages],
        max_completion_tokens: maxTokens, response_format: { type: 'json_object' },
      });
      const content = (response.choices && response.choices[0] && response.choices[0].message.content) || '';
      let card;
      try { card = { ...safeJsonParse(content), v9_html: `${stem}.v9.html` }; } catch (e) { card = null; reasons = [`not JSON: ${e.message}`]; }
      if (card) reasons = validate(card);
      if (card && reasons.length === 0) return { card, rounds: round, model: useModel };
      messages.push({ role: 'assistant', content },
        { role: 'user', content: `The gate REFUSED this card. Fix each reason and reply with the whole card.json:\n- ${reasons.join('\n- ')}` });
    }
    throw fail('card_refused', `v10 card refused: ${reasons.join('; ')}`, { reasons });
  };
  try { return await Promise.race([work(), deadline]); } finally { clearTimeout(timer); }
}

module.exports = { JOB, systemPrompt, userPrompt, authorCard };
