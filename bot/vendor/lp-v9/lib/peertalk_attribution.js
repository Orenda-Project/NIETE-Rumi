'use strict';
/**
 * bd-jgddp -- REPORTED SPEECH ABOUT THE BOOK IS NOT AN INSTRUCTION TO TALK.
 *
 * The PEER_TALK Opening gate hard-stopped 4 of 15 chapters of the G1-5 rebuild on strings
 * that QUOTE or DESCRIBE what is printed on the textbook page: a story character's line in
 * a read-aloud, a named textbook feature's own task, a page reference. The operator's rule
 * is unchanged and this file does not soften it --
 *
 *   *"teachers dont let students talk to each other, that too when the class begins"*
 *   *"Guided practice should stay as is, I only asked talking to be removed from opening"*
 *
 * -- what it adds is the one distinction the matcher in `peertalk.js` cannot make on its
 * own, because `peertalk.js` sees a phrase and this file sees the sentence around it.
 *
 * WHY "IT IS IN QUOTATION MARKS" IS NOT THE TEST, and would be a hole rather than a fix:
 * `Say: "Turn to your partner and discuss"` is inside quotation marks and IS the banned
 * move, delivered by the teacher's own mouth. Quoting is not attributing. So the exemption
 * turns on a SOURCE SUBJECT and a FINITE reporting verb:
 *
 *   the page asks / Page 141 says / Pinky says / the Skill Sharpener asks   -> reported
 *   Say: / Ask: / Tell them: / Now ask a classmate                          -> INSTRUCTION
 *
 * The finite-verb requirement is what carries that weight, and it is structural rather
 * than a blacklist: English imperatives are the BASE form (`say`, `ask`, `tell`, `show`),
 * a reported clause takes a finite one (`says`, `asked`, `tells`). A teacher writing an
 * instruction cannot reach the exemption without first inventing a subject for it, and the
 * subject must then survive SOURCES / ROLE_WORDS below.
 *
 * THREE SOURCE TIERS, all built from the 335-document build (`says?|asks?|...` + an opening
 * quote returned 126 distinct frames over the Opening sections; every tier below is a shape
 * that survey actually produced):
 *
 *   1. SOURCE_NOUNS  -- "The page asks, '...'", "The speech bubble says, '...'", "Page 141
 *      says: '...'", "Textbook page 209 says, '...'", "The grey-haired ... narrator says".
 *   2. A NAMED TEXTBOOK FEATURE -- "the Match and Weigh Partner Challenge asks each partner
 *      to ...", "The Skill Sharpener asks, '...'". GATED BY A CONSTANT; see below.
 *   3. A NAMED STORY CHARACTER -- "Pinky says, '...'", "Bunty asks, '...'", "Sir Riaz:
 *      “...”". A NAME is required, which is the tier's whole safety margin.
 *
 * DELIBERATELY NOT A TIER: an UNNAMED person on the page ("a boy asks, '...'", "an older
 * man says, '...'"). Two independent reasons, the second measured rather than argued.
 * (a) The ruling names "a named story character"; "an older man" is not named. (b) The one
 * live string it would exempt is g2_ch10/English_seg4's Opening, and that Opening ALSO runs
 * a small-circle SPEAKING CHAIN -- `Speaker 1 -> listen and nod -> Speaker 2`, "add to the
 * speaking chain" -- which no PEER_TALK pattern currently catches. Exempting its quoted
 * speech bubble would convert a correct block into a silent pass on a document that really
 * does put student-to-student talk in the Opening. A tier that buys a blind spot is not a
 * fix, so it is not here.
 */

/**
 * THE g5_ch10/Maths_seg6 DECISION, isolated to one flag ON PURPOSE.
 *
 * The string: `Say: "The Skill Sharpener asks, 'With a partner, calculate how many seconds
 * are in 15 minutes and 30 seconds.'"` -- an attributed quote of the textbook's own task,
 * which the teacher nevertheless SPEAKS ALOUD in the Opening, so a child can hear it and
 * act on it. That makes it unlike tier 3 (a character's line in a story) and unlike the
 * written Partner Challenge: the reported content is a task addressed to the reader.
 *
 * Shipped FALSE until 2026-09-25, because a gate fails closed and THIS WAS NOT A SILENT
 * RULING TO MAKE. It was put to the operator with the cost stated, and she ruled:
 *
 *   Q: "the teacher is just reading the page out. Does that count as talking in the
 *       Opening?"
 *   A: "It's the book talking -- let it through."   (bd-lqw3e, 2026-09-25)
 *
 * She accepted the stated cost in the same breath: a lesson CAN now quote a named
 * textbook feature to put partner talk in the Opening. Shipped TRUE from that ruling.
 * The anti-evasion structure is UNCHANGED by the flip: tier 2 still demands a FINITE
 * reporting verb, so a bare `Say: "Turn to your partner ..."` can never reach it.
 * Both directions stay pinned by tests -- the pin now pins `true`, so a silent flip
 * back is still caught. Reverting is the operator's call, not the gate's.
 */
const EXEMPT_NAMED_FEATURE_ATTRIBUTION = true;

/** Finite reporting verbs only. A BASE form is an imperative the teacher performs, so
 *  `say`, `ask`, `tell`, `read`, `write`, `show` are absent and must stay absent -- that
 *  omission is the anti-evasion, not an oversight. (`read` is excluded even as a past
 *  tense: it is spelt the same as the imperative and the corpus only ever uses the
 *  imperative, `Point to the speech bubble and read: "..."`.) */
const FINITE = 'says|said|asks|asked|tells|told|shows|showed|states|stated|writes|wrote'
  + '|invites|invited|wants|challenges|prompts|requests|explains|explained'
  + '|replies|replied|answers|answered|adds|added';

/** Nouns that denote the PRINTED SOURCE, never a person in the room. `partner`,
 *  `classmate`, `neighbour`, `student` and `child` are pointedly absent. */
const SOURCE_NOUNS = 'pages?|textbook|book|text|title|caption|sentence|line|story|poem'
  + '|rhyme|song|passage|paragraph|bubble|box|label|heading|signpost|sign|message'
  + '|picture|illustration|panel|chart|table|diagram|narrator|author|writer';

/** Capitalised words that are a ROLE or a teacher's own instruction, never a character.
 *  Without this, `Listener says, '...'` (a real corpus board label, from the turn-taking
 *  arrow `Speaker A -> Listener says "..."`) and `Say: "..."` would both read as people. */
const ROLE_WORDS = new Set([
  'Say', 'Ask', 'Tell', 'Read', 'Write', 'Show', 'Point', 'Draw', 'Model', 'Board', 'Note',
  'Prompt', 'Answer', 'Hint', 'Example', 'Aim', 'Goal', 'Dialogue', 'Message', 'Listener',
  'Listeners', 'Speaker', 'Speakers', 'Teacher', 'Teachers', 'Student', 'Students', 'Child',
  'Children', 'Kid', 'Kids', 'Class', 'Partner', 'Partners', 'Pair', 'Pairs', 'Group',
  'Groups', 'Pupil', 'Pupils', 'Everyone', 'Everybody', 'Today', 'Now', 'Then', 'Next',
  'First', 'Second', 'Finally', 'Again', 'Please', 'Here', 'There', 'One', 'Another',
]);

const HONORIFIC = '(?:Sir|Miss|Mr|Mrs|Ms|Dr|Baba|Amma|Ustad|Master|Chacha|Khala|Apa)\\.?\\s+';

const RE_FINITE = new RegExp(`\\b(?:${FINITE})\\b`, 'g');
const PRE_SOURCE = new RegExp(`(?:\\b(?:${SOURCE_NOUNS})(?:\\s+\\d{1,3})?|\\bp\\.?\\s*\\d{1,3})\\s+$`, 'i');
const PRE_FEATURE = new RegExp(`\\b[Tt]he\\s+[A-Z][A-Za-z]*(?:\\s+(?:and|of|for|the|&)\\s+[A-Z][A-Za-z]*|\\s+[A-Z][A-Za-z]*)+\\s+$`);
const PRE_NAME = new RegExp(`(?:${HONORIFIC})?([A-Z][a-z]+)\\s+$`);
const RE_COLON_DIALOGUE = new RegExp(`(?:^|[^A-Za-z])(?:${HONORIFIC})?([A-Z][a-z]+)\\s*:\\s*(["“«'])`, 'g');
/** What may NOT sit in front of a character's name: a determiner or another Title-Case
 *  word, both of which mean the capitalised token is part of a longer NAMED THING. */
const NOT_A_NAME_HEAD = /(?:\b[Tt]he|\b[Aa]n?|[A-Z][A-Za-z]*)\s+$/;

/** `norm()` leaves the curly DOUBLE quotes alone (it only flattens the single ones), so
 *  both families have to be understood here. */
const CLOSER = { '"': '"', "'": "'", '“': '”', '«': '»' };
const SENTENCE_END = /[.!?۔؟]/;

function isLetter(ch) { return ch !== undefined && /[A-Za-z]/.test(ch); }

/** End of the quotation opened at `open` (exclusive of the closing mark), or the end of the
 *  string if it is never closed. A straight `'` is also an apostrophe, so a candidate with
 *  a letter on both sides ("don't") does not close the quote. */
function quoteEnd(text, open) {
  const close = CLOSER[text[open]];
  for (let i = open + 1; i < text.length; i++) {
    if (text[i] !== close && !(close === '”' && text[i] === '"')) continue;
    if (close === "'" && isLetter(text[i - 1]) && isLetter(text[i + 1])) continue;
    return i;
  }
  return text.length;
}

/** End of the sentence that starts at `from` (exclusive of the terminal mark). */
function sentenceEnd(text, from) {
  for (let i = from; i < text.length; i++) if (SENTENCE_END.test(text[i])) return i;
  return text.length;
}

/** Does a source subject sit immediately before the reporting verb at `verbAt`? */
function sourceBefore(text, verbAt, namedFeature) {
  const pre = text.slice(Math.max(0, verbAt - 80), verbAt);
  if (PRE_SOURCE.test(pre)) return 'source-text';
  if (namedFeature && PRE_FEATURE.test(pre)) return 'named-feature';
  const m = PRE_NAME.exec(pre);
  if (!m || ROLE_WORDS.has(m[1])) return null;
  // A lone capitalised word is a character; the LAST WORD OF A TITLE-CASE PHRASE is not.
  // Without this, `The Skill Sharpener asks` reads as a character called "Sharpener" and
  // tier 3 silently grants what tier 2 exists to gate -- which is precisely the
  // g5_ch10/Maths_seg6 ruling escaping through the wrong door.
  return NOT_A_NAME_HEAD.test(pre.slice(0, pre.length - m[0].length)) ? null : 'named-character';
}

/** The span of material a reporting verb at [verbAt, verbEnd) actually reports, or null.
 *  Either the quotation it opens, or -- for an unquoted reported clause such as "the
 *  Challenge ASKS EACH PARTNER TO WRITE a mass" -- the rest of that sentence. A verb that
 *  reports nothing ("The page says something.") opens no span, which is what keeps the
 *  sentence-scoped branch from swallowing ordinary prose. */
function reportedSpan(text, verbEnd) {
  const lead = /^\s*[,:]?\s*/.exec(text.slice(verbEnd))[0].length;
  const at = verbEnd + lead;
  if (CLOSER[text[at]]) return { start: at + 1, end: quoteEnd(text, at) };
  const stop = sentenceEnd(text, verbEnd);
  const clause = text.slice(verbEnd, stop);
  return /^.{0,40}?\bto\s/i.test(clause) ? { start: verbEnd, end: stop } : null;
}

/** Every span of `text` (already `norm()`ed) that is reported from a source, not instructed.
 *  `opts.namedFeature` overrides EXEMPT_NAMED_FEATURE_ATTRIBUTION for tier 2. */
function attributedSpans(text, opts) {
  const namedFeature = (opts && 'namedFeature' in opts)
    ? opts.namedFeature : EXEMPT_NAMED_FEATURE_ATTRIBUTION;
  const spans = [];
  const finite = new RegExp(RE_FINITE.source, 'g');
  let m;
  while ((m = finite.exec(text)) !== null) {
    const source = sourceBefore(text, m.index, namedFeature);
    if (!source) continue;
    const span = reportedSpan(text, m.index + m[0].length);
    if (span && span.end > span.start) spans.push({ ...span, source });
  }
  const colon = new RegExp(RE_COLON_DIALOGUE.source, 'g');
  while ((m = colon.exec(text)) !== null) {
    if (ROLE_WORDS.has(m[1])) continue;
    const open = m.index + m[0].length - 1;
    spans.push({ start: open + 1, end: quoteEnd(text, open), source: 'named-character' });
  }
  return spans;
}

/** Is the PEER_TALK match [start, end) reported rather than instructed?
 *
 *  The test is on the match's END, not on full containment, and that is deliberate: the
 *  reporting verb is frequently the same word the matcher keys on -- "an older man SAYS,
 *  'Hey buddies! Discuss WITH YOUR CLASSMATES'" matches `talk verb with a partner` from
 *  `says` (outside the quote) to `classmates` (inside it). What has to be inside the
 *  reported span is the ADDRESSEE, and the addressee is at the end of every pattern. */
function isReported(text, start, end, opts) {
  return attributedSpans(text, opts).some((sp) => end > sp.start && end <= sp.end);
}

/** Writing verbs a peer may be directed to perform. Silent by construction. */
const WRITE_AFTER = /^[^.!?۔؟]{0,25}?\bto\s+(?:write|draw|copy|note|record|list|jot|fill|mark|tick)\b/i;
/** A spoken verb INSIDE the matched phrase forfeits the written ground: "Tell your partner
 *  to write a mass" is still a child telling a child, whatever happens afterwards. */
const SPOKEN_IN_MATCH = /\b(?:talk|talks|talking|speak|speaks|speaking|say|says|saying|said|tell|tells|telling|told|discuss|discusses|discussing|discussed|chat|chats|chatting|whisper|whispers|whispering|recite|recites|reciting|aloud)\b/i;

/**
 * THE OPERATOR'S SECOND PERMISSION, AND A SEPARATE GROUND FROM ATTRIBUTION.
 *
 * *"WRITTEN PEER EXCHANGE"* is allowed -- the corpus's Chalk Talk (*"They write, slide the
 * copy one place, write one line on a partner's answer, slide it back"*) is compliant and
 * must stay compliant. g3_ch10/Maths_seg4's *"the Match and Weigh Partner Challenge asks
 * each partner to WRITE a mass up to 3 kg"* is exempt on this ground ALONE, with every
 * attribution tier switched off, because what the partners do is write.
 *
 * Narrow on purpose: the writing verb must GOVERN the addressee (`... partner TO WRITE`),
 * within the same sentence. "Ask a classmate what they think. Then write it down." is two
 * moves, the first of them spoken, and stays a defect.
 */
function isWrittenExchange(text, start, end) {
  if (SPOKEN_IN_MATCH.test(text.slice(start, end))) return false;
  return WRITE_AFTER.test(text.slice(end));
}

/** The gate's question: may this PEER_TALK match be let through? */
function isExempt(text, start, end, opts) {
  return isReported(text, start, end, opts) || isWrittenExchange(text, start, end);
}

module.exports = {
  EXEMPT_NAMED_FEATURE_ATTRIBUTION,
  ROLE_WORDS,
  attributedSpans,
  isReported,
  isWrittenExchange,
  isExempt,
};
