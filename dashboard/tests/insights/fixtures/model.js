'use strict';
/**
 * Fictional fixtures for the model stage (w-model): a scripted fetch that stands in for OpenRouter, gloss gate strings and a
 * phonics transcript. No real names, ids or classroom text: every name below is invented and every line is a placeholder.
 */

function orBody(content, { cost = 0.0002, pin = 700, pout = 250, finish = 'stop' } = {}) {
  return { choices: [{ message: { content }, finish_reason: finish }], usage: { prompt_tokens: pin, completion_tokens: pout, cost } };
}

function res(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const ok = (obj, usage) => res(200, orBody(typeof obj === 'string' ? obj : JSON.stringify(obj), usage));
const http = (status, usage) => res(status, usage ? orBody('', usage) : { error: { code: status } });
const timeout = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

/** A fetch that answers from a queue; each entry is a response, an Error to throw, or a function returning either. */
function scriptedFetch(queue) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    let r = queue.shift();
    if (typeof r === 'function') r = r();
    if (r instanceof Error) throw r;
    if (!r) throw new Error('scriptedFetch: queue empty');
    return r;
  };
  fetch.calls = calls;
  return fetch;
}

// Gloss gate strings. The lexicon is invented; the Urdu token is written with a diacritic in one fixture to prove folding.
const LEXICON = ['Zarqonbek', 'Fictionalia', 'فرضیہ'];
const GLOSS = {
  clean: { en: 'Practice should have started; the class kept copying.', ur: 'یہاں سے مشق شروع ہونی چاہیے تھی؛ کلاس نقل کرتی رہی۔' },
  nameEn: { en: 'Zarqonbek answered the question aloud.', ur: 'یہاں سے مشق شروع ہونی چاہیے تھی۔' },
  nameUr: { en: 'Practice should have started here.', ur: 'فرضِیہ نے سوال کا جواب دیا۔' },
  nameLatinInUr: { en: 'Practice should have started here.', ur: 'یہاں fictionalia نے جواب دیا۔' },
  pronoun: { en: 'The teacher asked a question; she moved on.', ur: 'استاد نے سوال پوچھا۔' },
  script: { en: 'Practice should have started here.', ur: 'Yahan mashq shuru honi chahiye thi' },
  lengthEn: { en: 'The children worked in pairs on the sums from the board and checked each answer.', ur: 'بچوں نے جوڑیوں میں سوال حل کیے۔' },
  lengthUr: { en: 'The children worked in pairs.', ur: 'بچوں نے جوڑیوں میں بورڈ کے سوال حل کیے اور ہر جواب کو دوبارہ جانچا اور لکھا۔' },
  verbSing: { en: 'The teacher writes on the board.', ur: 'استاد بورڈ پر سوال لکھتی ہے۔' },
  verbHon: { en: 'The teacher asks a question.', ur: 'استاد بچوں سے سوال پوچھتے ہیں۔' },
  substringNoHit: { en: 'Fictionalianism is a placeholder word.', ur: 'استاد نے سوال پوچھا۔' },
};

// A fictional, timestamped literacy transcript (placeholder lines, no names).
const TRANSCRIPT = [
  '[00:05] Teacher: آج ہم حروف کی آوازیں سیکھیں گے۔',
  '[02:10] Teacher: ب کی آواز بَ، سب بولو۔',
  '[02:12] Student: بَ',
  '[05:30] Teacher: ب ... ا ... ت ... بات',
  '[05:34] Student: ب ا ت، بات!',
  '[09:00] Teacher: کتاب کو آوازوں میں توڑو۔',
  '[09:05] Student: ک، ت، ا، ب، کتاب ٹھیک',
  '[12:00] Teacher: ب زبر ل، بل',
  '[13:40] Teacher: کِ تاب، کِ تاب، سب مل کر',
  '[14:20] Student: میں پڑھوں؟ بات',
].join('\n');

const Q = {
  sound: 'ب کی آواز ب، سب بولو',            // diacritic dropped and punctuation changed: still grounded
  blend: 'ب ا ت بات',                       // dots removed: still grounded
  segment: 'ک ت ا ب کتاب ٹھیک',                       // commas removed: still grounded
  hijje: 'ب زبر ل، بل',
  syllable: 'کِ تاب، کِ تاب، سب مل کر',
  ungrounded: 'یہ جملہ اس سبق میں کبھی نہیں بولا گیا',
};

function phonicsOut({ applicable = true, stages = [], routines = [], score = 1, readAlone = null } = {}) {
  return {
    applicable,
    gate_reason: 'placeholder',
    stages_heard: stages.map(([stage, quote, at]) => ({ stage, at: at || '00:00', quote })),
    letter_name_routines: routines.map(([kind, quote, at]) => ({ kind, at: at || '00:00', quote })),
    syllable_only: false,
    read_alone_at: readAlone,
    score,
    gloss_en: 'placeholder prose that is never stored',
  };
}

module.exports = { orBody, res, ok, http, timeout, scriptedFetch, LEXICON, GLOSS, TRANSCRIPT, Q, phonicsOut };
