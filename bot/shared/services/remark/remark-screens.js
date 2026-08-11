/**
 * bd-2531 — the screens a principal reads while walking the rubric.
 *
 * Layout B (design spec §2, locked): ONE indicator per screen with the FULL
 * behavioural anchors visible. She is scoring a colleague's annual confidential
 * report — she must be able to read what a 3 means versus a 4 before tapping,
 * not infer it from a bare number.
 *
 * All copy is en + ur, complete (Rule 20). English is the deliberate floor for
 * any other language — never a blank, never "undefined".
 *
 * NOTE ON SCORES: the review screen DOES show the total. The no-scores rule
 * protects the TEACHER's message; the principal's own review is where she checks
 * her work, and hiding the number there would make it uncheckable.
 */

const {
  INDICATOR_COUNT, MAX_SCORE, SCALE,
  getIndicator, getAnchor, getIndicatorName, computeS,
} = require('./remark-rubric');

const LANGS = ['en', 'ur'];
const lang = (l) => (LANGS.includes(l) ? l : 'en');

const UI = {
  en: {
    of: (a, b) => `Indicator ${a} of ${b}`,
    scoring: (name) => `Evaluating *${name}*`,
    pick: 'Reply with 1, 2, 3 or 4.',
    comment: (name) => `Any comment about *${name}*?\n\nType it, or send a voice note. Reply *skip* if you have nothing to add.`,
    review_title: (name) => `*Review — ${name}*`,
    total: (s, max, pct) => `Total: ${s}/${max} (${pct}%)`,
    comment_label: 'Your comment',
    no_comment: '(none)',
    submit: 'Reply *submit* to confirm, or the indicator number (1-5) to change an answer.',
    teacher_unnamed: (tail) => `Teacher ${tail}`,
    teacher_unknown: 'Unnamed teacher',
  },
  ur: {
    of: (a, b) => `شعبہ ${a} از ${b}`,
    scoring: (name) => `*${name}* کا جائزہ`,
    pick: '1، 2، 3 یا 4 میں سے کوئی ایک بھیجیں۔',
    comment: (name) => `*${name}* کے بارے میں کوئی بات کہنا چاہیں گی؟\n\nلکھ کر بھیجیں یا وائس نوٹ بھیجیں۔ کچھ نہ کہنا ہو تو *skip* بھیجیں۔`,
    review_title: (name) => `*جائزہ — ${name}*`,
    total: (s, max, pct) => `کل: ${s}/${max} (${pct}%)`,
    comment_label: 'آپ کی رائے',
    no_comment: '(کچھ نہیں)',
    submit: 'تصدیق کے لیے *submit* بھیجیں، یا کوئی جواب بدلنے کے لیے شعبے کا نمبر (1-5) بھیجیں۔',
    teacher_unnamed: (tail) => `استاد ${tail}`,
    teacher_unknown: 'بے نام استاد',
  },
};

/**
 * A displayable teacher label.
 *
 * LIVE-DATA DEFECT: some NIETE teachers have first_name = null (verified against
 * the production users table). Rendering "undefined" to a principal reads as a
 * broken product, so fall back to the phone tail — enough for her to recognise
 * who it is — then to a generic label.
 */
function renderTeacherName(teacher, language = 'en') {
  const S = UI[lang(language)];
  const name = teacher && typeof teacher.first_name === 'string' && teacher.first_name.trim();
  if (name) return teacher.first_name.trim();
  const phone = teacher && teacher.phone_number;
  if (phone && String(phone).length >= 4) return S.teacher_unnamed(String(phone).slice(-4));
  return S.teacher_unknown;
}

/**
 * One rubric screen: the indicator, all four anchors in full, the prompt.
 */
function renderIndicatorScreen({ ordinal, teacher, language = 'en' }) {
  const L = lang(language);
  const S = UI[L];
  const name = renderTeacherName(teacher, L);

  const anchors = [4, 3, 2, 1]
    .map((level) => `*${level}* — ${SCALE[level][L]}\n${getAnchor(ordinal, level, L)}`)
    .join('\n\n');

  return [
    S.scoring(name),
    `${S.of(ordinal, INDICATOR_COUNT)}: *${getIndicatorName(ordinal, L)}*`,
    '',
    anchors,
    '',
    S.pick,
  ].join('\n');
}

function renderCommentPrompt({ teacher, language = 'en' }) {
  const L = lang(language);
  return UI[L].comment(renderTeacherName(teacher, L));
}

/**
 * The review screen — her own copy, WITH the numbers.
 * Throws on an incomplete rubric: computeS refuses to produce a total from a
 * partial, and rendering a wrong total is worse than refusing to render.
 */
function renderReview({ teacher, scores, comment, language = 'en' }) {
  const L = lang(language);
  const S = UI[L];
  const { s_score, s_pct } = computeS(scores);   // throws when incomplete
  const byOrdinal = new Map(scores.map((r) => [r.ordinal, r.score]));

  const lines = [];
  for (let o = 1; o <= INDICATOR_COUNT; o += 1) {
    const score = byOrdinal.get(o);
    lines.push(`${o}. ${getIndicatorName(o, L)} — *${score}* (${SCALE[score][L]})`);
  }

  const commentText = (typeof comment === 'string' && comment.trim()) || S.no_comment;

  return [
    S.review_title(renderTeacherName(teacher, L)),
    '',
    lines.join('\n'),
    '',
    S.total(s_score, MAX_SCORE, s_pct),
    '',
    `${S.comment_label}: ${commentText}`,
    '',
    S.submit,
  ].join('\n');
}

module.exports = {
  UI,
  renderTeacherName,
  renderIndicatorScreen,
  renderCommentPrompt,
  renderReview,
};
