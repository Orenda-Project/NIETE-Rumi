'use strict';
/**
 * bd-c5miz -- STUDENT-TO-STUDENT TALK IS BANNED. THE ONE PLACE THAT SAYS WHICH MOVES.
 *
 * VENDOR DIVERGENCE: this file is NOT upstream. It is a local rule of the Rumi G1-5
 * pipeline, required from `lint_lp.js` gate 10e. A re-vendor that drops it takes the gate
 * with it, which is why `tests/lp612/peer-talk-gate.test.js` pins both the list and the
 * gate's own code.
 *
 * WHY IT IS A GATE AND NOT A NOTE IN A DESCRIPTION. OPERATOR:
 *
 *   *"why cant we add what we have set as rule? Coaches gave this feedback to remove
 *   partner whisper, what Ive said should now be the pre-req"*
 *
 * This is field feedback from coaches, promoted to the prerequisite standard. A banned move
 * that is merely absent from a worked example is a banned move the next authoring pass
 * re-invents. So it fails.
 *
 * THE RULE, in her words, and both halves matter:
 *
 *   *"teachers dont let students talk to each other, that too when the class begins,
 *   neither in Guided Practice, how else can we do retrieval?"*
 *   *"In large classrooms, its just not possible to do so much in a class of 40+ students
 *   ... all teachers have said they can do only 1 activity per LP, that is reasonable"*
 *
 * PROHIBITED -- student-to-student TALK: a classmate answering aloud TO a classmate; pair /
 * partner / turn-and-talk / think-pair-share / buzz / elbow / shoulder partner; discussion
 * circles and group discussion; and unbounded queues ("as many as time allows", "go round
 * the class"), which are the same defect measured in minutes rather than in voices.
 *
 * EXPLICITLY ALLOWED, and the reason this file is a list of PHRASES and not a ban on the
 * word "partner":
 *
 *   - WRITTEN PEER EXCHANGE. The corpus's Chalk Talk is compliant and must stay compliant --
 *     *"They write, slide the copy one place, write one line on a partner's answer, slide it
 *     back."* Students exchange work on paper, silently. A keyword ban on "partner" would
 *     refuse the live Urdu lessons that run exactly this (`خاموش تبادلہ`), which is a
 *     regression, not a fix.
 *   - A CHILD SPEAKING TO THE WHOLE CLASS, OR TO THE TEACHER. Choral response is compliant;
 *     the live Urdu corpus value `ہَم آواز پَڑھائی` (choral reading) is compliant.
 *   - The live English corpus value `Prerequisite retrieval — write, walk, reveal`.
 *
 * So the axis is TALK BETWEEN STUDENTS, not the word "partner", and every pattern below
 * names a speech act with a classmate as its addressee.
 */

/**
 * URDU IS FIRST-CLASS HERE, NOT AN AFTERTHOUGHT. An English-only matcher would exempt every
 * Urdu lesson while LOOKING enforced, which is worse than no gate at all. Two things make
 * Urdu matchable:
 *
 *   1. The corpus is HARAKAT-HEAVY -- it writes `مَعْلُومات`, not `معلومات`. A plain Urdu
 *      regex misses all of it, so every string is stripped of diacritics, tatweel and the
 *      Quranic marks BEFORE matching. (`ﷺ`/`ؐ` are U+FDFA / U+0610-0615 and are left alone:
 *      RELIGIOUS_MARKS owns those and nothing here should touch them.)
 *   2. Urdu negates AFTER the verb (`بات نہیں کریں گے`) where English negates before
 *      (`do not tell a neighbour`). `WINDOW` below encodes that difference per language.
 */
const DIACRITICS = /[ً-ْٓ-ٕٖ-ٰٟـۖ-ۭ]/g;

/** Match-ready form: harakat gone, curly quotes and dashes flattened, whitespace collapsed. */
function norm(s) {
  return String(s == null ? '' : s)
    .replace(DIACRITICS, '')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[–—‒−]/g, '-')
    .replace(/\s+/g, ' ');
}

/**
 * THE BANNED MOVES. One entry per move, each named so the failure message tells an author
 * WHICH move to replace rather than just that something is wrong.
 *
 * `lang` is not decoration: it selects the negation window (see WINDOW).
 */
const PEER_TALK = [
  // The move this bead is named for, and the one the coaches asked to have removed.
  { lang: 'en', name: 'partner whisper', re: /\bpartner[- ]whispers?\b|\bwhisper (?:to|with) (?:a |an |your |their |the )?partner\b/i },
  // Whispering AT a named classmate. Deliberately requires the addressee: the corpus's own
  // hook prose has *"he whispered"* and *"he whispers, 'I can't wear these'"*, which is a
  // story character, not a classroom move.
  { lang: 'en', name: 'whisper to a classmate', re: /\bwhispers?(?:ing)?\s+(?:it\s+|that\s+|the answer\s+)?(?:to|with)\s+(?:a |an |your |their |the |his |her )?(?:partner|neighbou?r|classmate|friend|buddy|the person next to)/i },
  { lang: 'en', name: 'turn-and-talk', re: /\bturn[- ]and[- ]talk\b|\bturn to (?:a |your |the )?(?:partner|neighbou?r|classmate) and (?:talk|tell|say|share)\b/i },
  { lang: 'en', name: 'think-pair-share', re: /\bthink[- ]pair[- ]share\b/i },
  { lang: 'en', name: 'pair / partner / peer talk', re: /\b(?:pair|partner|peer|buddy)[- ](?:talk|chat|share|sharing|discussion)\b/i },
  { lang: 'en', name: 'group discussion', re: /\bgroup[- ](?:talk|chat|discussion)\b|\bdiscussion (?:in|by) groups\b/i },
  { lang: 'en', name: 'discussion circle', re: /\bdiscussion circles?\b|\bcircle[- ]time discussion\b/i },
  // "talk to each other" is caught by the `each` + `other` arm.
  { lang: 'en', name: 'talk to a classmate', re: /\b(?:talk|talks|talking|speak|speaks|speaking|chat|chats|chatting)\s+(?:quietly |softly |briefly |aloud )?(?:to|with)\s+(?:a |an |your |their |the |his |her |each )?(?:partner|neighbou?r|classmate|friend|buddy|other|one another)\b/i },
  { lang: 'en', name: 'tell a classmate', re: /\b(?:tell|tells|telling|say it to|share (?:it |your answer |the answer )?with|read (?:it |your answer )?(?:out )?to)\s+(?:a |an |your |their |the |his |her )?(?:partner|neighbou?r|classmate|buddy)\b/i },
  // THE POSSESSIVE IS NOT THE ADDRESSEE, and the live corpus turns on it: English_seg5's
  // Chalk Talk ends *"name three or four children to ask their CLASSMATE'S question aloud, to
  // the whole class"* -- a child speaking to the WHOLE CLASS, which is compliant, and it was
  // the only false positive the 20 live documents produced. `classmate's` is whose question it
  // is; `a classmate` is who is being spoken to. Only the second is banned.
  { lang: 'en', name: 'ask a classmate', re: /\b(?:ask|asks|asking)\s+(?:a |an |your |their |the |his |her |each )?(?:partner|neighbou?r|classmate|buddy|other)\b(?!['\u2019]s\b)/i },
  { lang: 'en', name: 'elbow / shoulder / talking partner', re: /\b(?:elbow|shoulder|talking|talk)\s+partners?\b/i },
  { lang: 'en', name: 'buzz groups', re: /\bbuzz\s+(?:group|session|pair)s?\b|\bbuzz\s+(?:with|about)\b/i },
  { lang: 'en', name: 'discuss in pairs / with a partner', re: /\bdiscuss(?:es|ing)?\s+(?:it |this |these |them |the answers? |your answers? )?(?:in (?:pairs|groups|threes|fours|twos)|with (?:a |an |your |their |the )?(?:partner|neighbou?r|classmate|group|friend))/i },
  // THE 40+ CLASSROOM, not a speech act -- but the same bead. *"In large classrooms, its just
  // not possible to do so much in a class of 40+ students"*: a queue with no bound is a
  // promise the period cannot keep, and it is how one activity becomes five.
  { lang: 'en', name: 'unbounded queue', re: /\bas many (?:pupils|students|children|kids|hands|answers)?\s*as time allows\b|\b(?:go|going|work)\s+(?:a)?round the (?:class|room|circle)\b|\bevery child (?:in turn |one by one )?(?:answers|speaks|says it) aloud\b/i },

  // ── Urdu ──────────────────────────────────────────────────────────────────────────────
  // Written against the DIACRITIC-STRIPPED form (see `norm`), which is why these carry no
  // harakat even though every live Urdu document does.
  { lang: 'ur', name: 'سرگوشی (whisper to a classmate)', re: /سرگوشی/ },
  { lang: 'ur', name: 'ساتھی سے بات (talk to your partner)', re: /ساتھی\s*(?:سے|کے\s*ساتھ|کو)\s*(?:بات|گفتگو|بات\s*چیت)/ },
  { lang: 'ur', name: 'جوڑی میں بات (pair talk)', re: /(?:جوڑی|جوڑے|جوڑوں)\s*میں\s*(?:بات|گفتگو|بات\s*چیت|بولیں|پوچھیں)/ },
  { lang: 'ur', name: 'آپس میں بات (talk among yourselves)', re: /آپس\s*میں\s*(?:بات|گفتگو|بات\s*چیت|بولیں|پوچھیں)/ },
  { lang: 'ur', name: 'ایک دوسرے سے بات (talk to each other)', re: /ایک\s*دوسرے\s*(?:سے|کو)\s*(?:بات|گفتگو|بات\s*چیت|پوچھ|بتائ|سنائ)/ },
  // The live enrichment's own instance: *"ساتھی نشان جانچے اور وجہ زبانی پوچھے"* -- a partner
  // checks the mark and asks the reason ALOUD. Written checking is fine; `زبانی` is not.
  { lang: 'ur', name: 'زبانی ساتھی جانچ (partner checks aloud)', re: /ساتھی[^۔.]{0,40}زبانی\s*(?:پوچھ|بتائ|کہے|سنائ)/ },
];

/**
 * A PROHIBITION OF A BANNED MOVE IS NOT THE BANNED MOVE.
 *
 * The live corpus states this rule on the page far more often than it breaks it --
 * *"Do not call out and do not tell a neighbour"*, *"Nobody calls out and nobody talks to a
 * neighbour"*, `بچے آپس میں بات نہیں کریں گے`. A matcher without this guard fails 12 of the
 * 20 live G1-5 documents on their own compliance sentence, which is exactly the "gate that
 * fails CORRECT work" failure mode this tree has been bitten by before (bd-nx6k6, bd-kpqu6).
 *
 * WINDOW encodes where each language puts its negation: English before the verb, Urdu after
 * it. Both windows are clamped to the sentence, so a prohibition in one sentence cannot
 * excuse an instruction in the next.
 */
const NEGATORS = {
  en: /\b(?:do not|don't|does not|doesn't|never|no one|nobody|not|without|instead of|rather than|no talking|no speaking|silently|in silence)\b/i,
  ur: /نہیں|نہ\s|مت\s|بغیر|اجازت\s*نہیں|خاموشی|خاموش/,
};
/** [chars before the hit, chars after it] that may carry the negation, per language. */
const WINDOW = { en: [70, 0], ur: [45, 45] };
const SENTENCE_END = /[.!?؟۔]/;

function negated(text, start, end, lang) {
  const [back, fwd] = WINDOW[lang];
  let from = Math.max(0, start - back);
  for (let i = start - 1; i >= from; i--) if (SENTENCE_END.test(text[i])) { from = i + 1; break; }
  let to = Math.min(text.length, end + fwd);
  for (let i = end; i < to; i++) if (SENTENCE_END.test(text[i])) { to = i; break; }
  return NEGATORS[lang].test(text.slice(from, start)) || (fwd > 0 && NEGATORS[lang].test(text.slice(end, to)));
}

/**
 * Every banned move an authored string ACTUALLY INSTRUCTS -- prohibitions of the same move
 * excluded. Returns `[{ name, lang, quote }]`, empty for a compliant string.
 */
function peerTalkDefects(s) {
  const text = norm(s);
  if (!text) return [];
  const out = [];
  for (const p of PEER_TALK) {
    const re = new RegExp(p.re.source, p.re.flags.includes('g') ? p.re.flags : p.re.flags + 'g');
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      if (negated(text, m.index, m.index + m[0].length, p.lang)) continue;
      out.push({ name: p.name, lang: p.lang, quote: text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).trim() });
      break; // one report per move per string; the author fixes the move, not each mention
    }
  }
  return out;
}

module.exports = { PEER_TALK, NEGATORS, peerTalkDefects, norm };
