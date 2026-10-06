'use strict';
/**
 * v3 `<lang>.words` and `<lang>.nonwords` — 50 items, 5 per row, 60 s, nothing right in the first 5 → stop
 * (EGRA Toolkit pp.196–197). Scored the way story.js scores a printed text: Gemini 3.8 Flash on the clip with
 * the study's STORY prompt verbatim (the item list as the text) and its strict schema, attempted capped at the
 * words Soniox heard from the child (story.capAttempted).
 * Review (R8 §4): English familiar words → the coach confirms the count; Urdu familiar words are AI-only;
 * made-up words are provisional (never reviewed).
 */
const prompts = require('../prompts');
const { verdictsFrom, capAttempted } = require('../story');
const { wordsIn } = require('../windows');
const { timedTask } = require('./engine');

const LANG_NAME = { ur: 'urdu', en: 'english' };
const TO_LETTER = { correct: 'c', wrong: 'w', skipped: 's' };

async function score(ctx) {
  const { spec, lang } = ctx;
  const items = spec.items.map(String);
  let spoken = null;
  const m = await timedTask(ctx, {
    refs: items,
    firstItems: items.slice(0, 2),
    variants: [{
      name: '', prompt: prompts.STORY({ lang: LANG_NAME[lang], tokens: items }), schema: prompts.STORY_SCHEMA,
      parse: (json) => {
        const v = verdictsFrom(json, items.length);
        const capped = spoken == null ? v : capAttempted(v, spoken);
        return capped.map((x) => ({ v: TO_LETTER[x], heard: '', conf: null }));
      },
    }],
    onClock: (clock, words) => { spoken = wordsIn(words, { start: clock.begin_at_s, end: clock.begin_at_s + 60 }, { excludeSpeaker: clock.coachSpeaker }).length; },
  });
  if (ctx.kind === 'words' && lang === 'en' && m.quality === 'ai_review' && !m.stopped_by_rule) m.count_flag = { reason: 'confirm_count' };
  return m;
}

module.exports = { score };
