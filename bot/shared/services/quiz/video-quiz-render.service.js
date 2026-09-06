'use strict';
/**
 * bd-2306 — VideoQuizRenderService: what a child receives, and in what order.
 *
 * This is the JS port of scripts/render_contract.py in the Video Quizzes report
 * folder. That file is what the entire Phase-1 QA pass judged — every image
 * review, every audio slot audit, every pedagogy verdict was made against the
 * sequence it produces. If this file and that one disagree, the QA describes a
 * product we do not ship. Keep them in step.
 *
 * THREE PHASES, proven on a real phone across five operator review rounds:
 *
 *   QUESTION     stem -> instruction clip -> STIMULUS clip -> question image
 *   INTERACTION  the tap surface, ALWAYS the last thing before answering
 *   ANSWER       verdict naming the option the child saw -> explanation text
 *                -> explanation image -> explanation audio
 *
 * build() is PURE: a quiz_questions row in, an ordered array of send
 * instructions out. No network, no DB, no manifest lookups — the importer bakes
 * resolved public URLs into `media` precisely so that nothing at delivery time
 * depends on a derived index that can go stale (R19).
 *
 * The rules referenced throughout live in the report's FEEDBACK_RULES.md. They
 * are not style preferences; each one is a bug that reached the operator.
 *
 * ONE MESSAGE PER QUESTION, AND WHY IT IS A CORRECTNESS RULE.
 * Every instruction this file emits costs one send against the recipient's
 * per-pair budget (video-quiz-rate-limiter.service.js: 5-minute rolling
 * window). A question that cost four sends — chrome counter, card image,
 * letter buttons, verdict — put an 8-question quiz at 32 sends against a
 * budget of 20, and a child who tapped fast waited three and a half minutes
 * per verdict while four answer handlers piled up behind the throttle
 * (staging, 2026-09-06, session ada1e109). So: the counter never gets a
 * message of its own (`counter` rides on the first message of the question,
 * and the sender folds it into that message's body or caption), and a picture
 * rides as the interactive message's own image HEADER wherever Meta allows one
 * — which is buttons, never lists. The cost per question is part of the
 * contract; anything added here has to be paid for out of that budget.
 */

const BUTTON_TITLE_MAX = 20;   // Meta hard limit; longer titles truncate silently
const { unicodeNotation } = require('./quiz-notation');
const LIST_ROW_TITLE_MAX = 24;
const LIST_ROW_DESCRIPTION_MAX = 72;  // Meta's row description cap
const MAX_BUTTONS = 3;

/**
 * Does a QUESTION CARD ride as the letter-picker's own image header?
 *
 * True is what makes a card question cost ONE send instead of three, which is
 * what makes an 8-question quiz fit the recipient's 5-minute window at all.
 *
 * WHAT IS NOT PROVEN. Meta's interactive-message reference states no size,
 * aspect-ratio or cropping rule for a button message's image header, and
 * nothing in this repo has ever sent a card that way — the P3 figure header
 * has, but every figure canvas is drawn at exactly 1.91:1 (1080x565), so it
 * has never exercised another shape. Live cards run from 0.74:1 to 2.08:1. If
 * a client is ever seen to crop or letterbox one, flip this to false: the card
 * goes back to its own image message ahead of the picker and nothing else
 * changes — the counter still comes off the card's own painted eyebrow.
 *
 * That rollback is not free. At three sends a card question, eight of them
 * plus the opener, the scorecard and the post-quiz offer is 27 against a cap
 * of 24 (video-quiz-rate-limiter.service.js), so flipping this back also means
 * re-costing that cap or trimming a send elsewhere.
 */
const CARD_RIDES_THE_PICKER = true;

/**
 * What the child READS for each option.
 *
 * R2: no option may render as empty — a child cannot tap "**". An option with
 * no text of its own is named by what it IS. The ANSWER phase reuses these
 * exact labels, so the verdict can never name something that was never shown.
 */
function optionLabels(q) {
  const raw = [q.option_a, q.option_b, q.option_c, q.option_d];
  const media = q.media || {};
  const optImages = new Map((media.option_images || []).map((o) => [o.index, o.url]));
  const optAudio = new Map((media.option_audio || []).map((o) => [o.index, o.url]));
  const labels = [];
  for (let i = 0; i < raw.length; i += 1) {
    const t = (raw[i] || '').trim();
    const hasImage = optImages.has(i);
    const hasAudio = optAudio.has(i);
    if (!t && !hasImage && !hasAudio) continue;   // option does not exist
    if (t) {
      // Verbatim, and NEVER filtered: an earlier version skipped the literal
      // "-" as a placeholder, which silently blanked the minus sign where it is
      // a real option in subtraction questions.
      // The importer already stored the label the child sees,
      // INCLUDING the "1. " prefix for picture options — re-applying it here
      // produced "1. 1. Flower" on every P5 question. Caught by the
      // Python/JS parity check, not by any unit test, because both sides
      // looked individually correct.
      labels.push(t);
    } else if (hasAudio) {
      labels.push(`Sound ${i + 1}`);
    } else {
      labels.push(`Picture ${i + 1}`);
    }
  }
  return labels;
}

function correctIndices(q) {
  return String(q.correct_option || '')
    .split(',')
    .map((c) => 'ABCD'.indexOf(c.trim()))
    .filter((i) => i >= 0);
}

/** Quote a symbol-only answer so "The answer is ." does not read as a typo. */
function nameAnswer(label) {
  if (!label) return '';
  return /[\p{L}\p{N}]/u.test(label) ? label : `“${label}”`;
}

/**
 * bd-2486 — option_feedback text is authored at content-generation time
 * against STORED option order (A=option_a, B=option_b, ...). The render-time
 * shuffle (bd-2359, above) repositions options for DISPLAY without touching
 * this pre-baked prose, so a letter reference inside it ("the correct answer
 * is B)") can name a different option than the one shown at that letter.
 * Confirmed against a real bug report: shuffle put the stored-correct option
 * at a different displayed letter than the feedback text named.
 *
 * Fixed by REMAPPING every letter token found, not stripping it — the
 * feedback stays just as specific, it just names the letter the child
 * actually saw. `order[shownPos] = storedIdx`, so inverting it gives, for
 * every stored letter, the shown letter to substitute.
 */
function storedToShownLetterMap(order) {
  const map = {};
  order.forEach((storedIdx, shownPos) => {
    const storedLetter = 'ABCD'[storedIdx];
    if (storedLetter) map[storedLetter] = optionLetter(shownPos);
  });
  return map;
}

/** Two shapes the corpus uses: "A) text..." and "...answer is B." (no paren). */
function remapLetters(text, letterMap) {
  if (!text) return text;
  let out = text.replace(/\b([A-D])\)/g, (m, letter) => `${letterMap[letter] || letter})`);
  out = out.replace(/\b(answer\s+is\s+)([A-D])\b(?!\))/gi,
    (m, prefix, letter) => `${prefix}${letterMap[letter] || letter}`);
  return out;
}

/**
 * Per-option feedback where the source has it.
 *
 * The generated half of the bank carries distractor-specific copy that names
 * the misconception ("you picked see, which is an action word"). The legacy
 * half has only a shared explanation and falls back to the generic branch.
 */
function feedbackFor(q, labels, order) {
  const fb = q.option_feedback || {};
  const letterMap = storedToShownLetterMap(order || labels.map((_, i) => i));
  const wrong = {};
  Object.entries(fb.wrong || {}).forEach(([k, v]) => {
    if (v && String(v).trim()) wrong[Number(k)] = remapLetters(String(v).trim(), letterMap);
  });
  return { correct: remapLetters((fb.correct || '').trim(), letterMap), wrong };
}

/** Buttons only when every title fits; otherwise the list, which is wider. */
function pickerKind(labels) {
  const fits = labels.length <= MAX_BUTTONS
    && labels.every((l) => l.length <= BUTTON_TITLE_MAX);
  return fits ? 'buttons' : 'list';
}

/**
 * The handle a row shows when the option itself will not fit (bd-2358).
 * Lists carry up to 10 rows, so this stays sane past D.
 */
function optionLetter(i) {
  return 'ABCDEFGHIJ'[i] || String(i + 1);
}

/**
 * The letters a picker actually offers, spelled out — "A, B or C".
 *
 * Under a QUESTION CARD the buttons carry letters and the copy has to name them.
 * It said "A, B or C" whatever the card held, so a two-option question told the
 * child to tap a C that was not there. The separator and the conjunction are the
 * CALLER's: both are language data (ux-strings), not layout, and Urdu's comma is
 * not a comma.
 */
function letterListLabel(count, { separator = ', ', conjunction = 'or' } = {}) {
  const letters = [];
  for (let i = 0; i < count; i += 1) letters.push(optionLetter(i));
  if (letters.length <= 1) return letters[0] || '';
  return `${letters.slice(0, -1).join(separator)} ${conjunction} ${letters[letters.length - 1]}`;
}

/**
 * Does this stem hand the whole question to a sound? (bd-2354)
 *
 * "Listen and tap." names no subject, so the clip that follows IS the subject
 * and has to be heard before the child can answer. "When switch is open" already
 * asks the question, so a clip arriving with it can only be telling the child
 * the answer. Port of CONTENTLESS_STEM in scripts/slot_audit.py — the two are
 * the same rule and must stay in step, since the certification gate uses the
 * Python one to decide what may ship.
 */
const LISTEN_AND_IDENTIFY = new RegExp(
  '^\\s*('
  + 'listen(\\s+and\\s+\\w+)?'
  + '|tap( the)?( correct)?( sound| answer| one)?'
  + '|choose( the)?( correct)?( sound| answer| one)?'
  + '|select( the)?( correct)?( sound| answer| one)?'
  + '|which sound (is it|do you hear)|what do you hear'
  + '|سنیں(\\s*اور\\s*\\S+)?'   // سنیں (اور …)
  + '|سنو(\\s*اور\\s*\\S+)?'         // سنو (اور …)
  + ')\\s*[.?!۔]?\\s*$', 'i',
);

function isListenAndIdentify(stem) {
  return LISTEN_AND_IDENTIFY.test((stem || '').trim());
}

function askBody(stem, labels, kind, isSoundQuestion) {
  // bd-2358: the body spells the options out only when the ROW cannot carry
  // them at all — i.e. past the description cap, which is 22 questions in the
  // whole bank. Keying this on the TITLE cap instead meant 3,049 questions
  // printed their options in the body AND in the row description AND (cut in
  // half) in the row title: the same three options, three times.
  const needsSpelling = kind === 'list'
    && labels.some((l) => l.length > LIST_ROW_DESCRIPTION_MAX);
  if (needsSpelling) {
    const lettered = labels.map((l, i) => `${optionLetter(i)}. ${l}`).join('\n');
    return `${stem}\n\n${lettered}`;
  }
  // "Which one did you hear?" belongs ONLY to a question whose subject is a
  // SOUND — i.e. one carrying a stimulus clip. Keying it on "has any audio"
  // replaced the stem of every narrated comprehension question, so a child
  // read "Which one did you hear?" above options about a coin toss. The
  // narration reads the question; it does not replace it.
  return isSoundQuestion ? 'Which one did you hear?' : stem;
}

// ── which slot the answer sits in (bd-2359) ─────────────────────────────────
//
// The correct answer sat at A on 38.1% of the live bank (46.0% of the legacy
// half, 39.9% of four-option questions against a 25% uniform). That is learnable,
// and a child who learns it stops reading the question.
//
// bd-1314 solved the same problem for /quiz by shuffling at GENERATION time and
// storing the result. This corpus is 13k already-stored rows, so the shuffle
// happens at RENDER time instead: no migration, reversible, and it cannot
// corrupt data it never writes.
//
// The order is derived from the question id alone, so it is FIXED per question
// (operator's call, 2026-07-28) — every child sees the same arrangement, and two
// children comparing phones agree. It must also be stable across processes and
// deploys, because build() runs once for the question and again for the answer:
// a drifting order would name a different option in the verdict than the one the
// child tapped. Hence a hashed seed rather than Math.random.

/** FNV-1a. Stable across processes and Node versions, unlike hashCode-by-hand. */
function hash32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, and good enough for shuffling four options. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The WHOLE option, not a phrase inside one. A looser rule flagged
// '"Gopi, you will iron all of these clothes," said Master Sahab.' — an ordinary
// option that should shuffle like any other.
const ANCHORED_LAST = /^\s*(all|none|both|any)\s+of\s+(the\s+above|these|them|the\s+others)\s*[.!۔]?\s*$/i;

/**
 * Some questions carry their meaning in the order itself. 315 live questions
 * (2.4%) fall into one of these classes, and moving their options would range
 * from confusing to wrong.
 */
function isOrderLocked(q, labels) {
  // Deliberately decided from the PATTERN and the LABELS only — the two things
  // the QA reference contract computes identically. An earlier version also
  // keyed on media.grid / option_images / option_audio, which the Python side
  // cannot see the same way (it reads corpus fields, not the derived media
  // blob), and the parity gate caught the two shuffling 2,962 questions
  // differently. Checked against production: pattern + labels covers all 189
  // rows whose media implies a lock, including the one P6b question whose
  // options are literally the text "Sound 1"/"Sound 2".
  //
  // A P5 grid is a pre-rendered image with the pictures already numbered, so
  // shuffling would point "1." at a picture nobody is looking at. Option clips
  // are bound to a slot and their labels name that slot.
  if (q.render_pattern === 'P5') return true;
  if (labels.some((l) => /^(Sound|Picture) \d+$/.test(l))) return true;
  if (labels.some((l) => ANCHORED_LAST.test(l))) return true;
  // optionLabels() compacts non-existent options away while correctIndices()
  // reads the raw A/B/C/D letter. Production has zero questions where those
  // disagree (all 11,831 checked), but if one ever appears, render it in stored
  // order rather than rearranging it around an answer key we cannot trust.
  const idx = correctIndices(q);
  if (!idx.length || idx.some((i) => i >= labels.length)) return true;
  return false;
}

/**
 * The order STORED on the row, if the row carries a usable one (round-5 D1).
 *
 * `media.display_order` is `[storedIdx, …]` indexed by DISPLAY POSITION, written
 * once when the quiz is generated. It is validated rather than trusted: anything
 * that is not a permutation of 0..n-1 is treated as absent, because a half-valid
 * order would rearrange the options around an answer key it no longer matches —
 * which is the bug this whole mechanism exists to end, in a new costume.
 *
 * @returns {number[]|null}
 */
function persistedOrder(q, n) {
  const raw = q && q.media && q.media.display_order;
  if (!Array.isArray(raw) || raw.length !== n) return null;
  const seen = new Set();
  for (const v of raw) {
    if (!Number.isInteger(v) || v < 0 || v >= n || seen.has(v)) return null;
    seen.add(v);
  }
  return raw.slice();
}

/**
 * The order the child sees, as ORIGINAL indices. Identity when order is locked.
 *
 * ONE ORDER, STORED ONCE (round-5 D1). The stored order wins over every other
 * branch, because it was computed BY this function at generation time and is the
 * only copy that every consumer — the question card's picture, the letter
 * buttons, the per-distractor feedback, the teacher's PDF — can all reach. The
 * seeded shuffle below stays as the fallback for the 13k PK video rows that were
 * stored before the column existed, and it depends on `external_id`, which any
 * `.select()` may forget: the operator's own staging run drew a card from a row
 * that had one and built the buttons from the same row re-selected without one,
 * so the letters on the picture and the letters under it named different
 * options. A stored order cannot be forgotten by a query that loads `media`.
 *
 * @returns {number[]} a permutation of 0..labels.length-1
 */
function displayOrder(q, labels) {
  const identity = labels.map((_, i) => i);
  const stored = persistedOrder(q, labels.length);
  if (stored) return stored;
  if (labels.length < 2 || isOrderLocked(q, labels)) return identity;
  // Seeded on external_id — the question's CONTENT identity ("leg:Grade5…:8"),
  // which is the same string in the corpus, the QA reference contract and every
  // environment. The row's uuid is none of those: it is assigned at import, so
  // seeding on it would reshuffle the whole bank on any re-import and would make
  // the QA reference disagree with production about what a child sees.
  const rnd = mulberry32(hash32(String(q.external_id || q.id || '')));
  const out = identity.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The "Question n of N" line, folded into a message that was going out anyway.
 *
 * It used to be its own `WhatsAppService.sendMessage` in
 * video-quiz.service.sendNextQuestion, which is a whole send off the
 * recipient's window for eleven characters of chrome — and, on a question
 * card, it arrived as a separate bubble above a picture that carried its own
 * "QUESTION 5 OF 8" caption, which is how the operator came to be looking at
 * two different numbers for one question.
 *
 * `counter` goes on the FIRST message the child reads for this question,
 * whatever that message is (the stem-with-listen-cue on an audio item, the
 * picker itself on everything else). The sender prepends the resolved string,
 * in the quiz language, to that message's body or caption. It is data here and
 * text there for the same reason every other label is: this module is pure and
 * language-free.
 *
 * A QUESTION CARD ALREADY PAINTS IT. transcript-quiz-card draws
 * "QUESTION 5 OF 8" into the picture itself, so a card question's messages are
 * marked `paintsOwnCounter` and get no line of their own — printing it again
 * under the picture is how the operator came to be reading two numbers for one
 * question. When every candidate message paints its own, the question carries
 * no separate counter at all, which is correct: it is already on screen.
 */
function attachCounter(msgs, opts) {
  const i = Number(opts && opts.questionNumber);
  const n = Number(opts && opts.totalQuestions);
  if (!Number.isInteger(i) || !Number.isInteger(n) || i < 1 || n < 1) return msgs;
  const first = msgs.find((m) => (m.phase === 'question' || m.phase === 'interaction')
    && !m.paintsOwnCounter);
  if (first) first.counter = { i, n };
  return msgs;
}

/**
 * Build the ordered message list for one question.
 * @param {Object} q a quiz_questions row (option_a..d, correct_option, media, …)
 * @param {Object} [opts] { questionNumber, totalQuestions }
 * @returns {Array<Object>} send instructions, in order
 */
function build(q, opts = {}) {
  return attachCounter(buildPhases(q, opts), opts);
}

function buildPhases(q, opts = {}) {
  const media = q.media || {};
  const pattern = q.render_pattern || 'P1';
  const stem = (q.question_text || '').trim();
  // `labels` stays in STORED order for the whole answer phase — the verdict,
  // the per-distractor feedback and correctIndices() are all keyed on it.
  // `shown`/`order` are the child's view. Mixing the two mis-scores silently.
  const labels = optionLabels(q);
  // PLAN_R5 D4 — a question whose answer is a SET has no tap surface in an
  // ordinary message: buttons and list rows are single-select. It is delivered
  // as a Flow with a CheckboxGroup, and everything about that — the order, the
  // cue, the payload, the verdict — lives in one module rather than as branches
  // through this file. Required lazily: that module reaches back here for
  // displayOrder().
  const Multi = require('./transcript-quiz-multi');
  if (Multi.isMultiRow(q)) {
    const mOrder = Multi.persistedOrder(q, labels) || displayOrder(q, labels);
    return Multi.buildMulti(q, {
      order: mOrder, shown: mOrder.map((i) => labels[i]), language: media.language,
    });
  }
  const order = displayOrder(q, labels);
  const shown = order.map((i) => labels[i]);
  const msgs = [];
  const add = (phase, kind, extra) => msgs.push({ phase, kind, ...extra });

  const questionAudio = media.question_audio || [];
  // bd-2354: a clip in the stimulus slot is only the SUBJECT of the question
  // when the stem does not already ask one. See LISTEN_AND_IDENTIFY.
  const stimulusIsSubject = !!media.stimulus_audio && isListenAndIdentify(stem);
  const stimulus = stimulusIsSubject ? media.stimulus_audio : null;
  // Anything else in that slot speaks the answer: it moves to the answer phase
  // rather than being dropped, so the child still hears it — just not first.
  const answerClip = media.answer_audio
    || (media.stimulus_audio && !stimulusIsSubject ? media.stimulus_audio : null);
  const hasListen = questionAudio.length > 0 || !!stimulus;

  // ── PHASE 1 — THE QUESTION ────────────────────────────────────────────────
  // R16: context before media. A voice note that lands before any text makes
  // the child guess what to listen FOR, and the stem then arrives after the
  // sound has already played.
  if (hasListen) {
    add('question', 'text', {
      body: `🎧 ${stem}\nListen, then choose your answer.`,
      role: 'stem_with_listen_cue',
    });
    questionAudio.forEach((url) => add('question', 'audio', { url, role: 'instruction' }));
    // R18, corrected by bd-2354: on a listen-and-identify item the clip legacy
    // names "AnswerAudio" IS the sound being asked about, so it must play before
    // the picker. R18 applied that to every row carrying the filename; on the
    // 1,788 with a real stem the same clip speaks the correct option aloud.
    if (stimulus) add('question', 'audio', { url: stimulus, role: 'stimulus' });
  }

  // A QUESTION CARD: the whole question is the picture (figure, stem, lettered
  // options in THIS display order) because WhatsApp text cannot draw the
  // notation or the options do not fit a button.
  //
  // The card DRAWS a letter for every option; the picker has to offer every
  // letter it drew. Meta caps a reply-button row at three, so a card with more
  // than three options takes the list (ten rows) — the same choice
  // `pickerKind()` makes everywhere else. Hardcoding `buttons` here silently
  // dropped D on a four-option card while its own footer said "Tap A, B, C or
  // D below": two contradictory instructions in one message pair, and one
  // answer the child could not give.
  //
  // WHICH PICKER IS ALSO HOW MANY SENDS THE QUESTION COSTS. An interactive
  // BUTTON message carries its own image header, so the card and the letters
  // are ONE message — the picture, the counter, the cue and the tap surface
  // arrive together, which is both a send saved and what the operator asked to
  // see on his phone. An interactive LIST is given no image header by Meta
  // (verified in whatsapp.service.js sendInteractiveMessage, and the reason
  // 161 P4 questions send their picture separately below), so a four-option
  // card still costs two. Never attach `headerImage` to a list: Meta drops it
  // silently and the child answers about a picture they never saw.
  if (media.question_card) {
    const cardKind = shown.length <= MAX_BUTTONS ? 'buttons' : 'list';
    const asHeader = CARD_RIDES_THE_PICKER && cardKind === 'buttons';
    if (!asHeader) {
      add('question', 'image', {
        url: media.question_card, caption: '', role: 'question_card', paintsOwnCounter: true,
      });
    }
    add('interaction', cardKind, {
      body: '', options: shown, optionIndices: order, letterTitles: true, role: 'ask',
      // The card carries "QUESTION n OF N" in the picture; the body must not
      // say it a second time. See attachCounter.
      paintsOwnCounter: true,
      ...(asHeader ? { headerImage: media.question_card } : {}),
    });
    // ── PHASE 3 — THE ANSWER ── (shared below)
    return finishAnswerPhase(q, msgs, labels, order, media, answerClip);
  }

  // The question image belongs to the QUESTION whatever the pattern — except
  // P3/P4, where it rides as the header of the interactive message itself.
  // Branching on pattern instead of on what the question HOLDS silently dropped
  // the image from 457 questions ("Count the circles in the picture", no
  // picture). Order is ear-then-eye, operator-approved.
  const headerPattern = pattern === 'P3' || pattern === 'P4';
  if (media.question_image && !headerPattern) {
    add('question', 'image', {
      url: media.question_image, caption: hasListen ? '' : stem, role: 'question_image',
    });
  }

  // ── PHASE 2 — THE INTERACTION (always last before the child answers) ──────
  const optionAudio = media.option_audio || [];
  const optionImages = media.option_images || [];
  const labelled = labels.every((l) => !/^(Sound|Picture) \d+$/.test(l));

  if (pattern === 'P5' && optionImages.length) {
    if (media.grid) {
      // Don't repeat the stem: it has already been shown as the listen cue or
      // as the question image's caption.
      const said = hasListen || !!media.question_image;
      add('interaction', 'image', {
        url: media.grid, caption: said ? 'Your options:' : stem, role: 'option_grid',
      });
    }
    // R8/R15: the pictures appear in BOTH places — the grid to compare them at
    // a glance, and the Flow where each option IS its picture
    // (RadioButtonsGroup, media-size large). Showing pictures and then asking
    // the child to answer from a text list is half the feature.
    add('interaction', 'flow', {
      body: 'Now tap the picture you think is right.',
      options: shown, optionIndices: order,
      // The Flow needs RAW BASE64 (same as the storybooks Flow's start.image);
      // a URL renders a picker with titles and no pictures. Encoded at import
      // time so nothing is fetched or resized on the child's critical path.
      optionImages: optionImages.map((o) => o.b64 || null),
      optionImageUrls: optionImages.map((o) => o.url),
      role: 'picture_flow',
      fallbackKind: pickerKind(shown),
    });
  } else if ((pattern === 'P6a' || pattern === 'P6b') && !labelled) {
    // Nothing to show but the sounds, so the clips ARE the options.
    // R4: each label is a QUOTED REPLY to the clip it names — without that, a
    // column of identical voice notes and a column of labels are related only
    // by luck.
    optionAudio.forEach((o) => {
      add('interaction', 'audio', { url: o.url, role: 'option_audio', optionIndex: o.index });
      add('interaction', 'text', {
        body: `${o.index + 1}️⃣ Sound ${o.index + 1}`,
        role: 'option_label', optionIndex: o.index, anchoredToPrevious: true,
      });
    });
    const soundKind = pickerKind(shown);
    add('interaction', soundKind, {
      body: askBody('Which sound was it?', shown, soundKind, false),
      options: shown, optionIndices: order, role: 'ask',
    });
  } else if (headerPattern && media.question_image) {
    const kind = pickerKind(shown);
    if (kind === 'buttons') {
      add('interaction', 'buttons', {
        body: stem, options: shown, optionIndices: order,
        headerImage: media.question_image, role: 'ask',
      });
    } else {
      // A LIST message cannot carry an image header — Meta allows only a text
      // header on interactive lists. So the picture goes as its own message
      // first, then the list. Attaching headerImage to a list would have been
      // silently dropped by Meta and the child would answer a question about a
      // picture they never saw (161 P4 questions).
      add('interaction', 'image', {
        url: media.question_image, caption: stem, role: 'question_image',
      });
      // The stem is already the image caption, so the body's job here is to
      // spell out any option too long for a 24-char row title.
      add('interaction', 'list', {
        body: askBody('Choose your answer', shown, 'list', false),
        options: shown, optionIndices: order, role: 'ask',
      });
    }
  } else {
    // R9: for a phonics item the target sound belongs to the QUESTION, not the
    // options. Playing every option's clip and then asking "which one is it"
    // assesses nothing — the child has just heard them all, in order. So when
    // the options have text, they are READ, never auto-played.
    const kind = pickerKind(shown);
    add('interaction', kind, {
      body: askBody(stem, shown, kind, !!stimulus),
      options: shown, optionIndices: order, role: 'ask',
    });
  }

  return finishAnswerPhase(q, msgs, labels, order, media, answerClip);
}

// ── the verdict marker (round-5 D2) ─────────────────────────────────────────
//
// The operator, on staging: "It's very hard for me to tell whether I got the
// question correct or incorrect. There should be in the message a checkmark or a
// cross." The author writes prose, not symbols, and that prose was used verbatim,
// so a child had to READ a paragraph to learn whether she was right. The
// sentence is the author's; the marker is ours.

const VERDICT_CORRECT = '\u2705';   // ✅
const VERDICT_WRONG = '\u274C';     // ❌
const RLM = '\u200F';
const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

/** The first character with a direction of its own — the one WhatsApp lays out by. */
function firstStrongIsLatin(text) {
  const m = /\p{L}/u.exec(text);
  return !!m && /[A-Za-z]/.test(m[0]);
}

/**
 * Open a verdict with its marker, once.
 *
 * The emoji is direction-NEUTRAL, so on an Urdu line it simply sits at the
 * logical start and the paragraph still runs right-to-left — unless the Urdu
 * itself opens with an English technical term, which rule 20 keeps in Latin
 * letters. Then the first strong character is Latin, WhatsApp lays the whole line
 * out left-to-right, and the Urdu full stop lands on the wrong side. U+200F after
 * the marker settles it, and is added ONLY in that case: a right-to-left mark on
 * an English line is invisible noise that still shows up in every log and diff.
 */
function withVerdictMark(text, mark) {
  const body = String(text == null ? '' : text).trim();
  if (!body) return body;
  if (body.startsWith(VERDICT_CORRECT) || body.startsWith(VERDICT_WRONG)) return body;
  const rtlFix = ARABIC_SCRIPT.test(body) && firstStrongIsLatin(body) ? RLM : '';
  return `${mark} ${rtlFix}${body}`;
}

/** PHASE 3 — THE ANSWER, shared by every pattern including the question card. */
function finishAnswerPhase(q, msgs, labels, order, media, answerClip) {
  const add = (phase, kind, extra) => msgs.push({ phase, kind, ...extra });
  // ── PHASE 3 — THE ANSWER ─────────────────────────────────────────────────
  // §4b invariant: every question, every pattern, both outcomes — and the
  // verdict names the option using the SAME label the picker showed.
  const idx = correctIndices(q);
  const rightLabels = idx.map((i) => labels[i]).filter(Boolean);
  const rightText = unicodeNotation(rightLabels.map(nameAnswer).join(' and '));
  const expl = (q.explanation || '').trim();
  const fb = feedbackFor(q, labels, order);

  add('answer', 'text', {
    body: withVerdictMark(
      unicodeNotation(fb.correct || `Correct! The answer is ${rightText}.${expl ? `\n\n${expl}` : ''}`),
      VERDICT_CORRECT),
    role: 'feedback_correct',
  });
  labels.forEach((label, i) => {
    if (idx.includes(i)) return;
    add('answer', 'text', {
      body: withVerdictMark(
        unicodeNotation(fb.wrong[i]
          || `Not quite — the answer is ${rightText}.${expl ? `\n\n${expl}` : ''}`
             + '\n\nKeep going, mistakes help you learn!'),
        VERDICT_WRONG),
      role: 'feedback_incorrect', optionIndex: i,
    });
  });
  if (media.explanation_image) {
    // R11/R17: kept only where a per-item verdict says the art explains THIS
    // question. Neither a blanket keep nor a blanket strip was right.
    add('answer', 'image', { url: media.explanation_image, role: 'explanation_image' });
  }
  // bd-2354: the spoken answer lands here, after the verdict and before the
  // explanation that unpacks it.
  if (answerClip) {
    add('answer', 'audio', { url: answerClip, role: 'answer_audio' });
  }
  if (media.explanation_audio) {
    add('answer', 'audio', { url: media.explanation_audio, role: 'explanation_audio' });
  }

  msgs.forEach((m, i) => { m.seq = i; });
  return msgs;
}

/** Button/row id the picker emits: vq_<questionId>_<optionIndex>. */
function answerId(questionId, index) {
  return `vq_${questionId}_${index}`;
}

/**
 * Parse a tap back to (questionId, optionIndex).
 * Returns null for ids belonging to any other feature — the router must not
 * claim `quiz_*` (the parent-quiz feature) or `student_video_feedback_*`.
 */
function parseAnswer(id) {
  // The `vq_` prefix alone is the discriminator — no other feature emits it.
  // An earlier version also demanded a UUID-shaped id, which would have
  // rejected any future id format for no safety gain.
  const m = /^vq_(.+)_(\d+)$/.exec(id || '');
  if (!m) return null;
  return { questionId: m[1], index: Number(m[2]) };
}

module.exports = {
  build,
  displayOrder,
  optionLabels,
  correctIndices,
  answerId,
  parseAnswer,
  optionLetter,
  letterListLabel,
  withVerdictMark,
  VERDICT_CORRECT,
  VERDICT_WRONG,
  BUTTON_TITLE_MAX,
  LIST_ROW_TITLE_MAX,
  LIST_ROW_DESCRIPTION_MAX,
  askBody,
};
