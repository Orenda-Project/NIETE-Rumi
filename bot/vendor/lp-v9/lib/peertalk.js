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
  // story character, not a classroom move. Widened twice over the original "whisper (it/
  // that/the answer) to a partner" -- the live corpus also runs it as a hyphenated compound
  // ("whisper-count with your partner", "whisper-partner retrieval") and with an addressee
  // object the original fixed list didn't anticipate ("whisper YOUR IDEA to your partner",
  // "whisper an ANSWER to a partner"). The gap is bounded and excludes `.!?` so it cannot
  // reach across an unrelated later sentence -- see the Maths_seg1 "whisper the reason...
  // compare every row with your partner" negative case, two sentences apart.
  { lang: 'en', name: 'whisper to a classmate', re: /\bwhispers?(?:ing)?[- ](?:count|check|read|partner)\b|\bwhispers?(?:ing)?\b[^.!?]{0,45}?\b(?:to|with)\b[^.!?]{0,20}?\b(?:partner|neighbou?r|classmate|friend|buddy)s?\b/i },
  // Dropped the "and (?:talk|tell|say|share)" requirement: the live corpus runs "turn to
  // your partner" as a colon-led prompt with no trailing verb at all --
  // *"Turn to your partner: can they BOTH be right?"* -- which is the same move.
  { lang: 'en', name: 'turn-and-talk', re: /\bturn[- ]and[- ]talk\b|\bturn to (?:a |your |the )?(?:partner|neighbou?r|classmate)\b/i },
  // Renamed from 'think-pair-share' -- the live corpus runs this as a whole family of named
  // protocols (Think-Pair-Check, Think-Pair-Say, Think-Pair-Explain, Think-Pair-Write,
  // Think-Pair-Say-Check, Think-pair-point-share...), all still Think + Pair + a talk step.
  { lang: 'en', name: 'think-pair-anything', re: /\bthink[- ]pair[- ][a-z]+\b/i },
  { lang: 'en', name: 'pair / partner / peer talk', re: /\b(?:pair|partner|peer|buddy)[- ](?:talk|chat|share|sharing|discussion)\b/i },
  { lang: 'en', name: 'group discussion', re: /\bgroup[- ](?:talk|chat|discussion)\b|\bdiscussion (?:in|by) groups\b/i },
  { lang: 'en', name: 'discussion circle', re: /\bdiscussion circles?\b|\bcircle[- ]time discussion\b/i },
  // "talk to each other" is caught by the `each` + `other` arm. `peer` added to the
  // addressee list below alongside partner/neighbour/classmate -- it's the same addressee,
  // just a different noun for it.
  { lang: 'en', name: 'talk to a classmate', re: /\b(?:talk|talks|talking|speak|speaks|speaking|chat|chats|chatting)\s+(?:quietly |softly |briefly |aloud )?(?:to|with)\s+(?:a |an |your |their |the |his |her |each )?(?:partner|neighbou?r|classmate|friend|buddy|peer|other|one another)\b/i },
  { lang: 'en', name: 'tell a classmate', re: /\b(?:tell|tells|telling|say it to|share (?:it |your answer |the answer )?with|read (?:it |your answer )?(?:out )?to)\s+(?:a |an |your |their |the |his |her )?(?:partner|neighbou?r|classmate|buddy|peer)\b/i },
  // THE POSSESSIVE IS NOT THE ADDRESSEE, and the live corpus turns on it: English_seg5's
  // Chalk Talk ends *"name three or four children to ask their CLASSMATE'S question aloud, to
  // the whole class"* -- a child speaking to the WHOLE CLASS, which is compliant, and it was
  // the only false positive the 20 live documents produced. `classmate's` is whose question it
  // is; `a classmate` is who is being spoken to. Only the second is banned.
  { lang: 'en', name: 'ask a classmate', re: /\b(?:ask|asks|asking)\s+(?:a |an |your |their |the |his |her |each )?(?:partner|neighbou?r|classmate|buddy|peer|other)\b(?!['\u2019]s\b)/i },
  { lang: 'en', name: 'elbow / shoulder / talking partner', re: /\b(?:elbow|shoulder|talking|talk)\s+partners?\b/i },
  { lang: 'en', name: 'buzz groups', re: /\bbuzz\s+(?:group|session|pair)s?\b|\bbuzz\s+(?:with|about)\b/i },
  { lang: 'en', name: 'discuss in pairs / with a partner', re: /\bdiscuss(?:es|ing)?\s+(?:it |this |these |them |the answers? |your answers? )?(?:in (?:pairs|groups|threes|fours|twos)|with (?:a |an |your |their |the )?(?:partner|neighbou?r|classmate|group|friend))/i },
  // THE 40+ CLASSROOM, not a speech act -- but the same bead. *"In large classrooms, its just
  // not possible to do so much in a class of 40+ students"*: a queue with no bound is a
  // promise the period cannot keep, and it is how one activity becomes five.
  { lang: 'en', name: 'unbounded queue', re: /\bas many (?:pupils|students|children|kids|hands|answers)?\s*as time allows\b|\b(?:go|going|work)\s+(?:a)?round the (?:class|room|circle)\b|\bevery child (?:in turn |one by one )?(?:answers|speaks|says it) aloud\b/i },
  // NAMED PAIR PROTOCOLS -- banned as protocol names in their own right, not because every
  // occurrence is provably a speech act. "Partner A" / "Partner B" is a role LABEL the live
  // corpus assigns even where the exchange described nearby is verbal (which it is: "Partner
  // A recites...", "Partner A says a number..."). CASE-SENSITIVE ON PURPOSE: lowercase
  // "partner a/b" in this corpus is the indefinite article ("Tell your partner A full short
  // sentence"), not the label, and those four instances are already caught by `tell a
  // classmate` / `ask a classmate` regardless.
  { lang: 'en', name: 'named pair protocol (Partner A/B)', re: /\bPartner\s+[AB]\b/ },
  // "Pair-Check" / "Partner-check" as a named protocol -- corpus instances are split between
  // silent ("partner-check by reading" is the outlier; most say "checks against", "checks
  // it") and explicitly aloud ("partner-check by READING each completed pair ALOUD"), but the
  // coaches' feedback that named this move for removal named it as a LABEL, so it is banned
  // as a label. NOTE: this is deliberately narrower than a bare "peer-check" -- see the peer
  // entries below for why that one is NOT banned.
  { lang: 'en', name: 'pair-check / partner-check', re: /\b(?:pair|partner)[- ]check(?:s|ed|ing)?\b/i },
  { lang: 'en', name: 'pair game', re: /\bpair[- ]game\b/i },
  // BARE "peer" is NOT banned outright -- the live corpus uses it for a struggling-student
  // differentiation role ("pair the struggling student with a confident peer"), a design-
  // rationale term in `.notes.gaps` ("peer-mediated retrieval"), and a silent written check
  // ("peer-check for a capital letter, full stop..." -- Chalk Talk in different words) that
  // must stay legal for the same reason Chalk Talk does. What's banned is a peer as the
  // SUBJECT of a talk verb -- *"peer says it together, then one pair shares aloud"* -- which
  // is the addressee patterns above read backwards.
  { lang: 'en', name: 'peer (talk verb, subject form)', re: /\bpeers?\s+(?:says?|said|tells?|told|asks?|asked|explains?|explained|recites?|recited)\b/i },

  // ROUND 2 -- bd-y7hst reopened. Two disclosed gaps the coordinator overruled as in-scope:
  // the "TALK-VERB ... with a partner" addressee form (the verb comes first, "with X" trails
  // it by a few words -- "Students count WITH A PARTNER", "practise ... WITH A PARTNER") and
  // the circle/turn-taking discussion family. Same bounded, punctuation-excluding gap
  // technique as `whisper to a classmate` above, so a match cannot cross a sentence boundary.
  //
  // POSSESSIVE EXCLUDED on purpose, same precedent as `ask a classmate`: "compare ... with
  // your partner's [book/notebook/writing]" is comparing against a physical object the
  // partner produced, not talking to them -- g5_ch10/Maths_seg5's "Compare your writing with
  // your partner's, then both of you compare against the board" and
  // g5_ch10/English_seg5's "quietly compare with your partner's book" are both silent. The
  // one disclosed miss this buys: g5_ch10/Maths_seg5's "...compare your notebook with your
  // partner's and explain the arrow..." also goes unflagged (no listed verb governs
  // "explain"), same tradeoff the existing `ask a classmate` entry already accepts.
  { lang: 'en', name: 'talk verb with a partner', re: /\b(?:says?|saying|said|tells?|telling|told|shar(?:e|es|ed|ing)|reads?|reading|counts?|counted|counting|practi[cs](?:e|es|ed|ing)|recit(?:e|es|ed|ing)|asks?|asking|asked|answers?|answering|answered|discuss(?:es|ing)?|discussed|compar(?:e|es|ed|ing)|checks?|checked|checking)\b[^.!?]{0,45}?\bwith\s+(?:a\s+|an\s+|your\s+|their\s+|the\s+)?(?:partner|neighbou?r|classmate|buddy|friend)s?\b(?!['’]s\b)/i },
  // CIRCLE / TURN-TAKING DISCUSSION FAMILY -- children seated in a circle (or small circles;
  // the live corpus writes both) taking spoken turns. Three shapes, all corpus-evidenced:
  // (1) "sit(s/ting)/sat in a/small circle(s)" governing a nearby talk verb, or "with
  // classmates/friends/peers/group(s)" -- catches the coordinator's own cited anchor
  // (g4_ch9's "Students sit in circles ... Each student shares ...") and "Sit in a circle
  // with your classmates."; (2) "in a/small circle(s), each student/child/pupil/pair/person"
  // -- the coordinator's own example construction, widened to also allow a sentence break
  // ("circles" then a period) before "Each ...", which is how the live g2_ch10 speaking-chain
  // lesson actually writes it ("Sit in small circles. Each person will share...", "...your
  // earlier circle. Each student tells the new group..."); (3) bare "circle(s) with
  // classmate(s)/partner(s)/..." with no governing verb required, for corpus instances that
  // drop "sit" entirely ("Form a new small circle with classmates who were not in your
  // earlier circle."). Verified against the corpus's heavy use of "circle" as a 2D-shape noun
  // and as the "draw a ring around" verb (g1_ch10 geometry) -- none of those co-occur with
  // "sit ... in ... circle" or "circle(s) with <addressee>", so no new false-positive risk.
  { lang: 'en', name: 'circle / turn-taking discussion', re: /\b(?:sit(?:s|ting)?|sat)\s+in\s+(?:a\s+|small\s+)?circles?\b[^.!?]{0,60}?\b(?:shares?|sharing|shared|asks?|asking|asked|discuss(?:es|ing|ed)?|explains?|explaining|explained|tells?|telling|told|with\s+(?:your\s+|their\s+|the\s+)?(?:classmates?|friends?|peers?|groups?))\b|\bin\s+(?:a\s+|small\s+)?circles?[.,]?\s+each\s+(?:student|child|pupil|pair|person)\b|\bcircles?\s+with\s+(?:a\s+|an\s+|your\s+|their\s+|the\s+)?(?:classmates?|partners?|neighbou?rs?|buddi?es?|friends?|groups?)\b/i },
  // A child RESPONDING TO another child by name/role, not to the teacher or the whole class --
  // the other half of the coordinator's cited g4_ch9 anchor ("...responds to one peer with a
  // thumbs up..."). Deliberately requires the "to <addressee>" object; a bare "responds," with
  // no addressee (as in g2_ch10's "the next student responds, 'I like... because...'") is left
  // to the circle-discussion pattern / doc-level flagging elsewhere in the same document.
  { lang: 'en', name: 'responds to a classmate', re: /\b(?:responds?|responded|responding|replies|replied|replying)\s+to\s+(?:one|a|another|their|the)\s+(?:peer|classmate|partner|neighbou?r|buddy)\b/i },

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

  // bd-yjmxh -- TWO REAL CORPUS MISSES, both the VERB-DIRECTED-AT-A-PEER construction (an
  // addressee immediately followed by کو, "to [them]", then a recite/tell verb) -- not a ban
  // on the bare noun. `ساتھی` alone, and `پارٹنر` alone, both appear innocently throughout the
  // corpus (a struggling-student pairing note, a protocol label) and must stay clean; what is
  // banned is the addressee being TOLD something, aloud, by name.
  //
  // 1) g5_ch9/Urdu_seg7 warm-up item 1, verbatim: *"'راہ گیر' لفظ کو دو اجزا میں توڑ کر اپنے
  //    ساتھی کو سنائیں۔"* -- break the word into two parts and RECITE IT TO YOUR COMPANION.
  //    Stems on `سنا`/`بتا` (not the fuller `سنائ`/`بتائ` some other entries use) so every
  //    conjugation matches as a substring -- سنائیں، سنائے، سناؤ، سنانا، سناتا all contain
  //    `سنا`; بتائیں، بتاؤ، بتانا، بتاتی all contain `بتا`. Grep against the live corpus turned
  //    up a wide family this same construction covers: `ساتھی کو بتائیں`, `... سناتا ہے`,
  //    `... سنانے کے لیے`, `... سنا کر`, `... زبانی بتائیں` -- all directed speech, all now
  //    caught. Deliberately NOT extended to `سمجھا` (explain) -- the corpus also has `ساتھی کو
  //    سمجھائیں`, but that is a different verb outside the recite/say/tell family this bead
  //    scoped, and is left as a known, undocumented-here gap rather than guessed into scope.
  { lang: 'ur', name: 'ساتھی کو سنانا/بتانا (recite/tell TO a companion)', re: /ساتھی\s*کو\s*(?:سنا|بتا)/ },
  // 2) g5_ch10/Urdu_seg6 warm-up item 2, verbatim: *"پارٹنر کو بتائیں: ببلو کے صبر کا پیمانہ
  //    کیوں لبریز ہوا تھا؟"* -- the TRANSLITERATED English word `پارٹنر`, not ساتھی/جوڑی, told
  //    to. Same construction, same two verb stems -- read straight out of the doc, not
  //    guessed; a second live instance is `پارٹنر کو بتائیں کہ آپ کو ...`.
  { lang: 'ur', name: 'پارٹنر کو بتانا (transliterated partner, told to)', re: /پارٹنر\s*کو\s*(?:سنا|بتا)/ },
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
 *
 * bd-yjmxh -- `نہ\s` (bare "نہ" + a space, the short form of "don't") needs its OWN
 * boundary guard, unlike the alternatives beside it: Urdu has no shortage of ordinary nouns
 * that END in نہ and are routinely followed by a space -- `پیمانہ` (scale/measure), `زمانہ`
 * (era), `بہانہ` (excuse), `نشانہ` (target) among them. Without a guard, `نہ\s` matches
 * their tail and wrongly suppresses a real violation whenever one lands within the forward
 * window -- exactly what g5_ch10/Urdu_seg6's *"...بتائیں: ببلو کے صبر کا پیمانہ کیوں..."*
 * did to the new transliterated-پارٹنر entry above (`پیمانہ کیوں` -- `نہ` + space -- sat
 * inside its 45-char forward window). Per this file's own rule that JS `\b` does not work on
 * Arabic script, the fix is not `\b` but an explicit negative lookbehind: `نہ\s` may not be
 * preceded by another Arabic-script character (U+0600-U+06FF), so it only fires when `نہ` is
 * its own token (preceded by whitespace, punctuation, or the start of the clause) and not
 * when it is merely the last two letters of a longer, unrelated word. The other alternatives
 * (`نہیں`, `مت\s`, `بغیر`, `خاموشی`, `خاموش`) are unchanged -- each was checked against the
 * live corpus and none is currently known to false-fire the same way -- so this stays a
 * narrow fix to the one alternative proven to misfire, not a rewrite of the negator.
 */
const NEGATORS = {
  en: /\b(?:do not|don't|does not|doesn't|never|no one|nobody|not|without|instead of|rather than|no talking|no speaking|silently|in silence)\b/i,
  ur: /نہیں|(?<![؀-ۿ])نہ\s|مت\s|بغیر|اجازت\s*نہیں|خاموشی|خاموش/,
};
/** [chars before the hit, chars after it] that may carry the negation, per language. */
const WINDOW = { en: [70, 0], ur: [45, 45] };
const SENTENCE_END = /[.!?؟۔]/;

/**
 * A boundary the negation window must not cross. `SENTENCE_END` alone missed a real corpus
 * case: *"you're not sure exactly when - tell your partner one present-perfect sentence about
 * it."* -- "not" belongs to the clause before the dash, but with no dash boundary it sits
 * inside the 70-char backward window of "tell your partner" and wrongly suppresses a genuine
 * violation. `norm()` has already flattened em/en-dashes to a plain `-`, so a SPACE-FLANKED
 * dash (not a hyphenated compound like "turn-and-talk") is treated as a clause break too.
 */
function isBoundary(text, i) {
  return SENTENCE_END.test(text[i]) || (text[i] === '-' && text[i - 1] === ' ' && text[i + 1] === ' ');
}

function negated(text, start, end, lang) {
  const [back, fwd] = WINDOW[lang];
  let from = Math.max(0, start - back);
  for (let i = start - 1; i >= from; i--) if (isBoundary(text, i)) { from = i + 1; break; }
  let to = Math.min(text.length, end + fwd);
  for (let i = end; i < to; i++) if (isBoundary(text, i)) { to = i; break; }
  return NEGATORS[lang].test(text.slice(from, start)) || (fwd > 0 && NEGATORS[lang].test(text.slice(end, to)));
}

/**
 * Every banned move an authored string ACTUALLY INSTRUCTS -- prohibitions of the same move
 * excluded. Returns `[{ name, lang, quote, index, end }]`, empty for a compliant string.
 *
 * bd-jgddp -- `index`/`end` are the match's half-open span IN THE NORMALISED TEXT
 * (`norm(s)`), not in the raw string: `norm` collapses whitespace and rewrites quotes, so a
 * raw-string offset would not survive it. They exist so a CALLER can ask where the hit sits
 * relative to the rest of the sentence -- the Opening gate uses them to tell an instruction
 * apart from a textbook line the lesson merely quotes (lib/peertalk_attribution.js). They
 * are additive: `quote` is unchanged and no existing caller reads them.
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
      out.push({
        name: p.name,
        lang: p.lang,
        quote: text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).trim(),
        index: m.index,
        end: m.index + m[0].length,
      });
      break; // one report per move per string; the author fixes the move, not each mention
    }
  }
  return out;
}

module.exports = { PEER_TALK, NEGATORS, peerTalkDefects, norm };
