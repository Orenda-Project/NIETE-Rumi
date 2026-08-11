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
 */

const BUTTON_TITLE_MAX = 20;   // Meta hard limit; longer titles truncate silently
const LIST_ROW_TITLE_MAX = 24;
const LIST_ROW_DESCRIPTION_MAX = 72;  // Meta's row description cap
const MAX_BUTTONS = 3;

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
 * The order the child sees, as ORIGINAL indices. Identity when order is locked.
 * @returns {number[]} a permutation of 0..labels.length-1
 */
function displayOrder(q, labels) {
  const identity = labels.map((_, i) => i);
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
 * Build the ordered message list for one question.
 * @param {Object} q a quiz_questions row (option_a..d, correct_option, media, …)
 * @param {Object} [opts] { questionNumber, totalQuestions }
 * @returns {Array<Object>} send instructions, in order
 */
function build(q, opts = {}) {
  const media = q.media || {};
  const pattern = q.render_pattern || 'P1';
  const stem = (q.question_text || '').trim();
  // `labels` stays in STORED order for the whole answer phase — the verdict,
  // the per-distractor feedback and correctIndices() are all keyed on it.
  // `shown`/`order` are the child's view. Mixing the two mis-scores silently.
  const labels = optionLabels(q);
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

  // ── PHASE 3 — THE ANSWER ─────────────────────────────────────────────────
  // §4b invariant: every question, every pattern, both outcomes — and the
  // verdict names the option using the SAME label the picker showed.
  const idx = correctIndices(q);
  const rightLabels = idx.map((i) => labels[i]).filter(Boolean);
  const rightText = rightLabels.map(nameAnswer).join(' and ');
  const expl = (q.explanation || '').trim();
  const fb = feedbackFor(q, labels, order);

  add('answer', 'text', {
    body: fb.correct || `✅ Correct! The answer is ${rightText}.${expl ? `\n\n${expl}` : ''}`,
    role: 'feedback_correct',
  });
  labels.forEach((label, i) => {
    if (idx.includes(i)) return;
    add('answer', 'text', {
      body: fb.wrong[i]
        || `Not quite — the answer is ${rightText}.${expl ? `\n\n${expl}` : ''}`
           + '\n\nKeep going, mistakes help you learn!',
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
  optionLabels,
  correctIndices,
  answerId,
  parseAnswer,
  optionLetter,
  BUTTON_TITLE_MAX,
  LIST_ROW_TITLE_MAX,
  LIST_ROW_DESCRIPTION_MAX,
  askBody,
};
