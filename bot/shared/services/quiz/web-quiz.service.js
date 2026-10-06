'use strict';
/**
 * THE WEB CHILD QUIZ — the channel-free service behind /api/internal/wq/*.
 *
 * A child opens the class link on a web page instead of answering WhatsApp
 * messages. Everything here reads and writes the SAME rows the WhatsApp quiz
 * does — quiz_share_codes, quiz_sessions (source 'share_link'), quiz_answers,
 * students — so the teacher's 12-hour report, /quiz counts, the nudge and the
 * hardest-question tallies see a web child exactly like a WhatsApp child. It
 * sends nothing on WhatsApp: no function here calls the WhatsApp service.
 *
 * What is different on the web, and why:
 *   - A web session has no phone (parent_phone NULL). The class-card sender
 *     already skips a missing phone, so nothing is ever sent for one.
 *   - device_ref (server-random, per browser) replaces the phone as "which
 *     handset": it tells a replay on the same phone from one on a sibling's.
 *   - The FIRST finished attempt per child counts (first_completed), so a
 *     replay is practice and cannot raise a class score. WhatsApp keeps its
 *     latest-attempt rule; the report picks the rule per class code (attemptRuleFor).
 *   - The teacher's own preview (a signed `p` token) is stored with
 *     user_id = the teacher — the existing self-test marker — so it never
 *     reaches the roster, the average or the league table.
 *
 * Errors are thrown as WqError {status, body}; the router turns them into
 * responses. No phone number, no child's full name and no free text is logged.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const T = require('./web-quiz-token');
const WebItems = require('./web-quiz-items');
const Figure = require('./web-quiz-figure');
const PictureZoom = require('./web-quiz-picture-zoom');
const Pictures = require('./pictures');
const { pointsAtPicture } = require('./quiz-picture-words');
const { pageTopic } = require('./quiz-child-title');
const GatesV2 = require('./quiz-author-gates-v2');

const { presupposesPicture } = GatesV2;
const Funnel = require('./quiz-funnel');
const { oneAttemptPerChild } = require('./one-attempt-per-child');
const { excludeSelfTests } = require('./teacher-self-test');
const { clampLanguage } = require('../../config/ux-strings');
const { teacherLabel } = require('./quiz-teacher-label');
const Roster = require('./web-quiz-roster');
const Identity = require('./web-quiz-identity');
const IdRoster = require('./web-quiz-identity-roster');
const WebQuizBrand = require('../../config/web-quiz-brand');
const { orgName, botName } = require('../../config/branding');

const QUESTIONS_MAX = 15;          // = video-quiz.service QUESTIONS_PER_SESSION
const CHIPS_MAX = 40;
const CHIP_WINDOW_DAYS = 90;
const BOARD_TOP = 7;
const MEDIA_TTL_S = 6 * 60 * 60;
const CODE_RX = /^[A-Z0-9]{4,12}$/;
const SLOT_RX = /^[A-D](,[A-D])*$/;
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const SLOTS = ['A', 'B', 'C', 'D'];

class WqError extends Error {
  constructor(status, body) {
    super(body && body.error ? body.error : `web quiz ${status}`);
    this.status = status;
    this.body = body;
  }
}
const fail = (status, error, extra = {}) => { throw new WqError(status, { error, ...extra }); };

function requireOn() {
  if (!T.secret()) fail(503, 'web_quiz_off');
}

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const norm = (s) => String(s || '').toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();
const levelFor = (pct) => (pct >= 80 ? 'mastered' : pct >= 60 ? 'developing' : 'needs_practice');
const normSlots = (v) => String(v || '').toUpperCase().replace(/[^A-D]/g, '').split('').sort().join(',');

/** Midnight in Pakistan (UTC+5, no DST) for "today" counts, as an ISO string. */
function pktMidnightIso(now = Date.now()) {
  const local = new Date(now + PKT_OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - PKT_OFFSET_MS).toISOString();
}

// ─── the code ───────────────────────────────────────────────────────────────

const SC_COLS = 'id, code, quiz_id, video_id, teacher_user_id, teacher_name, topic, language, '
  + 'active, expires_at, invited_by_student_id, parent_share_code_id';

/**
 * Resolve a class code or a friend's challenge code. A challenge code collapses
 * to its PARENT (the teacher's code), exactly as resolveInvite does for
 * WhatsApp, so the child counts toward the same class report. A code with a
 * parent and NO inviter is a "watch another video" code (web-quiz-videos.js):
 * it plays its own video quiz, so it is not collapsed.
 */
async function resolveCode(rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!CODE_RX.test(code)) fail(404, 'not_found');
  const { data: sc, error } = await supabase.from('quiz_share_codes').select(SC_COLS).eq('code', code).maybeSingle();
  if (error) fail(502, 'db_unavailable');
  if (!sc) fail(404, 'not_found');
  const lang = clampLanguage(sc.language);
  // The same test beginFromCode applies to the code that was used.
  if (!sc.active || (sc.expires_at && new Date(sc.expires_at) < new Date())) fail(410, 'expired', { lang });
  let parent = sc;
  if (sc.parent_share_code_id && sc.invited_by_student_id) {
    const { data: p } = await supabase.from('quiz_share_codes').select(SC_COLS).eq('id', sc.parent_share_code_id).maybeSingle();
    if (p) parent = p;
  }
  return {
    code, lang, row: sc, parent,
    shareCodeId: parent.id,
    quizId: parent.quiz_id || sc.quiz_id,
    teacherUserId: parent.teacher_user_id,
    invitedByStudentId: sc.invited_by_student_id || null,
    moreVideosOf: sc.parent_share_code_id && !sc.invited_by_student_id ? sc.parent_share_code_id : null,
  };
}

// ─── questions ──────────────────────────────────────────────────────────────

const Q_COLS = 'id, external_id, sort_order, question_text, option_a, option_b, option_c, option_d, '
  + 'correct_option, explanation, option_feedback, media, render_pattern';

/**
 * A question the page can play. A stem that sends the child to a picture
 * ("Look at the pictures. Which one is a leaf?") needs one: the row's own
 * picture file, a figure, or picture options. Without any, the child would be
 * asked about a picture that is not there, so the web quiz leaves it out and
 * the score counts only the questions that were played.
 */
function hasPicture(q) {
  const m = (q && q.media) || {};
  const w = m.web && typeof m.web === 'object' ? m.web : {};
  if (questionImageOf(m)) return true;
  if (Array.isArray(m.option_images) && m.option_images.some(Boolean)) return true;
  if (Array.isArray(w.options) && w.options.some((o) => o && (o.pic || o.img))) return true;
  // Options that are pictures themselves (emoji, no letter or digit): today's WhatsApp picture question.
  const texts = [q.option_a, q.option_b, q.option_c, q.option_d].map((t) => String(t == null ? '' : t).trim()).filter(Boolean);
  if (texts.length >= 2 && texts.every((t) => !/[\p{L}\p{N}]/u.test(t))) return true;
  // Last, because it draws: a figure counts only if it actually draws (what E2 would send).
  try { return Boolean(Figure.figureFor(q)); } catch { return false; }
}

function playable(q) {
  const web = WebItems.webPayload(q);
  const stem = (web && web.text) || (q && q.question_text) || '';
  // A stem that points at a picture ("look at the picture") or supposes one ("if a diagram
  // shows…", the authoring gate's own rule) is not played without that picture: quizzes written
  // before the gate still carry such stems.
  return !(pointsAtPicture(stem) || presupposesPicture(stem)) || hasPicture(q);
}

/**
 * A word_blank that is not the question asked (quiz-author-gates-v2 WORD_BLANK_NOT_ASKED /
 * WORD_BLANK_NOT_A_WORD): 318 of 392 production items hide a letter of a word the question treats
 * as whole, or hold a sentence. Gates v2, web only: the picture goes; a stem that stands on its own
 * then plays as text, one that needs the picture is left out by playable(). Never below
 * WORD_BLANK_FLOOR playable items — then the quiz plays as today, logged.
 */
const WORD_BLANK_FLOOR = 3;
function wrongWordBlank(row) {
  const fig = row && row.media && row.media.figure;
  if (!fig || String(fig.type || '').toLowerCase() !== 'word_blank') return false;
  const options = [row.option_a, row.option_b, row.option_c, row.option_d].filter((o) => o != null && String(o).trim() !== '');
  const correct = 'ABCD'.indexOf(String(row.correct_option || '').trim().toUpperCase().charAt(0));
  const q = { question: row.question_text || '', options, correct_index: correct >= 0 ? correct : null, figure: fig };
  return GatesV2.questionErrors(q, 0, { language: (row.media && row.media.language) || undefined })
    .some((e) => /WORD_BLANK_NOT_(ASKED|A_WORD)/.test(e));
}
function withoutFigure(row) {
  const media = { ...row.media };
  delete media.figure;
  delete media.question_image;
  if (media.web && typeof media.web === 'object' && media.web.figure) { media.web = { ...media.web }; delete media.web.figure; }
  return { ...row, media };
}
async function withoutWrongWordBlanks(quizId, served, out, { log = false } = {}) {
  if (!served.some(wrongWordBlank)) return out;
  if (!(await GatesV2.refreshFlag())) return out;
  const wrong = new Set(served.filter(wrongWordBlank).map((q) => q.id));
  const fixed = served.map((q) => (wrong.has(q.id) ? withoutFigure(q) : q)).filter(playable);
  if (fixed.length < WORD_BLANK_FLOOR) {
    if (log) logEvent('web_quiz.word_blank_kept', { quizId, n: wrong.size, served: out.length });
    return out;
  }
  if (log) {
    const kept = new Set(fixed.map((q) => q.id));
    logEvent('web_quiz.word_blank_hidden', {
      quizId, hidden: [...wrong].filter((id) => !kept.has(id)), text_only: [...wrong].filter((id) => kept.has(id)),
    });
  }
  return fixed;
}

/** The quiz's questions in the order a WhatsApp child gets them, capped like a session; only playable ones. */
async function loadQuestions(quizId, { log = false } = {}) {
  const { data, error } = await supabase.from('quiz_questions').select(Q_COLS)
    .eq('quiz_id', quizId).order('external_id', { ascending: true }).order('sort_order', { ascending: true });
  if (error) fail(502, 'db_unavailable');
  const rows = data || [];
  // One ordering rule for both channels (transcript bank by sort_order, video
  // bank legacy-first) — the WhatsApp engine's own function.
  const { orderForSession } = require('./video-quiz.service');
  const served = orderForSession(rows).slice(0, QUESTIONS_MAX);
  let out = served.filter(playable);
  out = await withoutWrongWordBlanks(quizId, served, out, { log });
  if (log && out.length < served.length) {
    const qids = served.filter((q) => !playable(q)).map((q) => q.id);
    logEvent('web_quiz.unplayable_skipped', { quizId, n: qids.length, qids, served: out.length });
  }
  return out;
}

function mediaUrl(code, qid, k) {
  return `/api/wq/media/${code}/${qid}?k=${k}`;
}

/**
 * The picture file behind `img` and E10 ?k=q. Never media.question_card: that is
 * the WhatsApp card, the stem and the lettered options painted into a PNG in
 * display order; on the page the stem and options are already text, so the
 * card repeated them and its letters could disagree with the buttons. A figure
 * question's own PNG (question_image) is the drawing only.
 */
function questionImageOf(media) {
  const m = media || {};
  // A picture the review judged misleading (Figure.pictureHidden) is not shown: the
  // question plays on its text, or, when its stem sends the child to the picture, is
  // left out like any picture question with no picture (playable).
  if (Figure.pictureHidden(m)) return null;
  if (m.question_image) return m.question_image;
  // The grid is WhatsApp's collage of the picture OPTIONS ("1. word" painted
  // under each). When the options carry their own pictures the page shows those
  // as the answer tiles, so the grid would show every option twice.
  const ownPictures = Array.isArray(m.option_images) && m.option_images.some(Boolean);
  return ownPictures ? null : m.grid || null;
}

function optionImageOf(media, i) {
  const list = (media && media.option_images) || null;
  return Array.isArray(list) ? list[i] || null : null;
}

const mediaLang = (m) => clampLanguage(m && m.language);

/** The v2 item's picture for this slot (media.web.options[].pic), if any. */
function webOptionPic(media, slot) {
  const opts = media && media.web && Array.isArray(media.web.options) ? media.web.options : null;
  const o = opts ? opts.find((x) => x && x.slot === slot) : null;
  return o && o.pic ? o.pic : null;
}

function feedbackFor(q, i) {
  const fb = q.option_feedback;
  const wrong = fb && typeof fb === 'object' ? fb.wrong : null;
  const v = wrong ? wrong[String(i)] : null;
  // Stored for WhatsApp ("C) Good try! … The correct answer is B) …"): the page keeps the mix-up
  // and the reason only — its letters differ, it names the answer itself, and never praises a miss.
  const clean = typeof v === 'string' ? require('./web-quiz-feedback').cleanWrongFeedback(v) : '';
  return clean || null;
}

/**
 * The options in the ONE order every other surface shows them in — the
 * WhatsApp quiz, the question card's letters, the teacher's PDF answer key
 * (video-quiz-render displayOrder: the stored media.display_order, else the
 * same seeded shuffle). Each option keeps its stored slot, so the answer key,
 * the feedback and the media links are untouched. Options the render module
 * counts differently from this payload keep the stored order.
 */
function inDisplayOrder(q, options) {
  try {
    const render = require('./video-quiz-render.service');
    const order = render.displayOrder(q, render.optionLabels(q));
    if (order.length !== options.length) return options;
    return order.map((k) => options[k]);
  } catch (e) {
    logToFile('⚠️ web-quiz: display order unavailable, stored order kept', { error: e.message });
    return options;
  }
}

function questionPayload(row, i, code, audio, zoom) {
  // A figure's own A-D part names become P-S everywhere the page shows them.
  const q = Figure.withPartLetters(row);
  const options = [];
  [q.option_a, q.option_b, q.option_c, q.option_d].forEach((text, idx) => {
    if (text == null || String(text).trim() === '') return;
    const o = { slot: SLOTS[idx], text: String(text) };
    if (optionImageOf(q.media, idx)) {
      // Near-identical pictures are served cropped to where they differ (web-quiz-picture-zoom).
      o.img = mediaUrl(code, q.id, SLOTS[idx]) + (zoom ? '&z=1' : '');
      const name = Figure.pictureOptionName(text);
      o.text = name || '';
      if (name) o.name = name;
    }
    const pic = webOptionPic(q.media, SLOTS[idx]);
    if (pic) o.pic = pic;
    const fb = feedbackFor(q, idx);
    if (fb) o.fb = fb;
    options.push(o);
  });
  // Today's WhatsApp picture question sends its options as emoji (🌸 🍃 🌰 🥕).
  // On the page each becomes a colour picture tile, unnamed: the picture is the option.
  const nouns = options.map((o) => (o.img || o.pic ? null : Pictures.emojiNoun(o.text)));
  if (options.length >= 2 && nouns.every(Boolean)) {
    options.forEach((o, k) => { o.pic = { kind: 'pictogram', name: nouns[k], unnamed: true }; });
  }
  const out = {
    qid: q.id, i: i + 1, text: q.question_text || '', pattern: q.render_pattern || null,
    options: inDisplayOrder(q, options), correct_slot: normSlots(q.correct_option), why: q.explanation || null,
  };
  if (out.correct_slot.includes(',')) out.multi = true;
  // SCHEMA_v2: a web item (media.web) carries its own type/options/key; absent = today's question.
  const web = WebItems.webPayload(q);
  if (web) {
    Object.assign(out, web);
    (out.options || []).forEach((o) => {
      if (o && typeof o.fb === 'string') {
        const clean = require('./web-quiz-feedback').cleanWrongFeedback(o.fb);
        if (clean) o.fb = clean; else delete o.fb;
      }
    });
  }
  if (questionImageOf(q.media)) out.img = mediaUrl(code, q.id, 'q');
  const figure = Figure.figureFor(q);
  if (figure) {
    const { src, ...rest } = figure;
    out.figure = src ? { ...rest, url: mediaUrl(code, q.id, 'q') } : rest;
  }
  if (audio && audio[q.id]) out.audio = audio[q.id];
  // Last, after anything that fills options: picture options become drawings.
  Figure.drawOptionPics(out.options, mediaLang(q.media));
  if (Array.isArray(out.left)) out.left = Figure.drawOptionPics(out.left.map((l) => ({ ...l })), mediaLang(q.media));
  return out;
}

/** The sibling media helpers (read-aloud clips, lesson video); absent or failing = no audio / no video, never an error. */
function mediaHelpers() {
  try { return require('./web-quiz-media'); } catch { return null; }
}

// ─── the class's name chips ────────────────────────────────────────────────

/**
 * Children who played THIS teacher's links in the last 90 days (not invited
 * friends, not the teacher's own runs), most recent first, capped at 40.
 * Internal rows carry studentId; the public chip never does.
 */
async function classChips(ctx) {
  const since = new Date(Date.now() - CHIP_WINDOW_DAYS * 86400000).toISOString();
  const { data: codes } = await supabase.from('quiz_share_codes').select('id')
    .eq('teacher_user_id', ctx.teacherUserId).is('invited_by_student_id', null).gte('created_at', since).limit(200);
  const ids = (codes || []).map((c) => c.id);
  if (!ids.includes(ctx.shareCodeId)) ids.push(ctx.shareCodeId);
  const { data: sessions } = await supabase.from('quiz_sessions')
    .select('student_id, student_name, user_id, created_at, share_code_id')
    .in('share_code_id', ids).is('invited_by_student_id', null).not('student_id', 'is', null)
    .gte('created_at', since).order('created_at', { ascending: false }).limit(500);
  const seen = new Set();
  const chips = [];
  // A phone remembers the chip it was given on an earlier link of this teacher;
  // chips are minted per code, so keep every code's chip for the child as an alias.
  const aliases = new Map();
  for (const s of sessions || []) {
    if (!s.student_id || !s.share_code_id) continue;
    if (!aliases.has(s.student_id)) aliases.set(s.student_id, new Set());
    aliases.get(s.student_id).add(T.chipId(s.share_code_id, s.student_id));
  }
  for (const s of excludeSelfTests(sessions || [], ctx.teacherUserId)) {
    if (!s.student_id || seen.has(s.student_id)) continue;
    seen.add(s.student_id);
    const first = firstName(s.student_name);
    if (!first) continue;
    chips.push({ chip: T.chipId(ctx.shareCodeId, s.student_id), first, animal: T.animalFor(s.student_id), studentId: s.student_id, name: s.student_name,
      aliases: aliases.get(s.student_id) || new Set() });
    if (chips.length >= CHIPS_MAX) break;
  }
  return chips;
}

const publicChip = (c) => ({ chip: c.chip, first: c.first, animal: c.animal });

/** A roster child as a public chip: first name and animal, the class label only when it tells two classes apart. */
function rosterChip(ctx, { kid, label }, one = null) {
  const c = { chip: T.chipId(ctx.shareCodeId, kid.id), first: firstName(Roster.displayName(kid, ctx.lang)), animal: T.animalFor(kid.id) };
  if (label) c.cls = label;
  // Two children of the class share this first name: the roll number tells the child which card is theirs.
  const twin = one && one.kids.some((k) => k.id !== kid.id && norm(firstName(Roster.displayName(k, ctx.lang))) === norm(c.first));
  if (twin && kid.roll_number != null) c.roll = Number(kid.roll_number);
  return c;
}

// ─── live counts ────────────────────────────────────────────────────────────

async function liveCounts(ctx) {
  const since = pktMidnightIso();
  const out = { class_today: 0, ict_today_floor: 0 };
  try {
    const { data } = await supabase.from('quiz_sessions').select('student_id, user_id, status, completed_at, created_at')
      .eq('share_code_id', ctx.shareCodeId).is('invited_by_student_id', null).eq('status', 'completed').gte('completed_at', since);
    out.class_today = oneAttemptPerChild(excludeSelfTests(data || [], ctx.teacherUserId)).length;
    const { count } = await supabase.from('quiz_sessions').select('id', { count: 'exact', head: true })
      .eq('source', 'share_link').eq('status', 'completed').is('user_id', null).gte('completed_at', since);
    out.ict_today_floor = count || 0;
  } catch (e) {
    logToFile('⚠️ web-quiz: live counts unavailable', { error: e.message });
  }
  return out;
}

// ─── E2 the quiz ────────────────────────────────────────────────────────────

async function getQuiz(code, { p } = {}) {
  requireOn();
  const ctx = await resolveCode(code);
  const [questions, { data: quizRow }] = await Promise.all([
    loadQuestions(ctx.quizId, { log: true }),
    supabase.from('quizzes').select('id, topic, grade, subject, language, meta, video_id, list_id').eq('id', ctx.quizId).maybeSingle(),
  ]);
  if (!questions.length) fail(404, 'no_questions');
  const helpers = mediaHelpers();
  let audio = {};
  let video = null;
  if (helpers) {
    try { audio = (await helpers.presignAudio((quizRow && quizRow.meta) || {}, { expiresIn: MEDIA_TTL_S })) || {}; } catch { audio = {}; }
    const videoId = ctx.parent.video_id || (quizRow && quizRow.video_id) || null;
    if (videoId) {
      try { video = (await helpers.presignVideo({ video_id: videoId }, { db: supabase, expiresIn: MEDIA_TTL_S })) || null; } catch { video = null; }
    }
  }
  // A quiz without its read-aloud clips (or with clips of an older voice version) gets them now,
  // recorded by the worker: the backfill for quizzes authored before clips were made at authoring.
  try {
    const Publish = require('./web-quiz-publish.service');
    Publish.requestQuizAudio(ctx.quizId, { meta: (quizRow && quizRow.meta) || {} }).catch(() => {});
  } catch { /* the page reads aloud */ }
  // The item's own recorded clips (the sound of a "whose sound is this?" item).
  try { audio = await require('./web-quiz-sound').withRecordedClips(questions, audio, { expiresIn: MEDIA_TTL_S }); } catch { /* the page reads aloud */ }
  // Identity v2: the child types their name and the server matches inside the hand-out's class.
  const idn = await identityV2(ctx);
  // A teacher with a class list: the child gives a roll number, so no classmates' names ship.
  const roster = idn ? null : await Roster.loadRoster(ctx.teacherUserId, { grade: quizRow && quizRow.grade });
  // v2 ships no classmates' names at all: only this phone's remembered children (page storage).
  const chips = idn || roster ? [] : await classChips(ctx);
  // A quiz whose class the server cannot tell (two lists, no grade match): the page asks the class first.
  const pick = roster ? Roster.pickList(roster, { listId: quizRow && quizRow.list_id, grade: quizRow && quizRow.grade }, (id) => classKey(ctx, id)) : null;
  const preview = Boolean(p) && isPreviewFor(p, ctx);
  // The class and the teacher are named exactly as the teacher's own texts
  // name them: the forwarded WhatsApp message's "Teacher <name>", and the
  // report's class heading for this code (null until a child has finished).
  let label = null;
  try {
    // A "watch another video" code is named after the class code it came from.
    const cls = await require('./video-quiz-report.service').loadClassRows(ctx.moreVideosOf || ctx.shareCodeId);
    label = (cls && cls.className) || null;
  } catch { label = null; }
  const zooms = await Promise.all(questions.map((q) => PictureZoom.zoomFor(q).catch(() => null)));
  const out = {
    quiz: {
      id: ctx.quizId, code: ctx.code,
      topic: pageTopic({ lang: ctx.lang, meta: quizRow && quizRow.meta, fallback: ctx.parent.topic || (quizRow && quizRow.topic) }),
      lang: ctx.lang, dir: ctx.lang === 'ur' ? 'rtl' : 'ltr',
      grade: (quizRow && quizRow.grade) || null, subject: (quizRow && quizRow.subject) || null,
      n: questions.length,
      questions: questions.map((q, i) => questionPayload(q, i, ctx.code, audio, zooms[i])),
    },
    cls: {
      label, teacher: teacherLabel(ctx.parent.teacher_name, ctx.lang), chips: chips.map(publicChip),
      ...(roster ? { roster: { lists: roster.lists.length, ...(pick.ask ? { classes: pick.ask } : {}) } } : {}),
      ...(idn ? { identity: await identityBoot(ctx, idn) } : {}),
    },
    live: await liveCounts(ctx),
    video,
    preview,
    // Which brand the page wears: a key only; the edge owns the brand's look.
    brand: await WebQuizBrand.resolveBrandKey({ db: supabase, orgName, botName }),
  };
  if (ctx.invitedByStudentId) out.challenge = await challengeOf(ctx);
  return out;
}

async function quizInfo(quizId) {
  try {
    const { data } = await supabase.from('quizzes').select('grade, list_id').eq('id', quizId).maybeSingle();
    return { grade: (data && data.grade) || null, listId: (data && data.list_id) || null };
  } catch { return { grade: null, listId: null }; }
}

/** An opaque per-code key for one of the teacher's class lists (the page never sees a list id). */
const classKey = (ctx, listId) => T.chipId(ctx.shareCodeId, `list:${listId}`);

/**
 * The teacher's roster and the ONE class this quiz plays against (the child's
 * chosen class key, else the quiz's list, else its grade's list). `one` is the
 * roster cut to that class; `ask` lists the classes when the child must choose.
 */
async function oneClass(ctx, chosen) {
  const q = await quizInfo(ctx.quizId);
  const roster = await Roster.loadRoster(ctx.teacherUserId, { grade: q.grade });
  if (!roster) return { roster: null, grade: q.grade };
  const pick = Roster.pickList(roster, { listId: q.listId, grade: q.grade, chosen: chosen == null ? null : String(chosen) }, (id) => classKey(ctx, id));
  return { roster, grade: q.grade, ask: pick.ask || null, one: pick.ask ? null : Roster.onlyList(roster, pick.list) };
}

async function gradeOf(quizId) {
  try {
    const { data } = await supabase.from('quizzes').select('grade').eq('id', quizId).maybeSingle();
    return (data && data.grade) || null;
  } catch { return null; }
}

// ─── E11 the teacher's "Who played?" (their own preview link only) ──────────

function requireTeacher(body, ctx) {
  if (!body.p || !isPreviewFor(body.p, ctx)) fail(401, 'bad_token');
}

/** A counted row as the teacher sees it: first name and roll number only. */
function whoRow(s, roster, lang) {
  const listed = roster ? roster.kids.find((k) => k.id === s.student_id) : null;
  return {
    ref: s.id,
    first: firstName(listed ? Roster.displayName(listed, lang) : s.student_name),
    roll: listed && listed.roll_number != null ? Number(listed.roll_number) : null,
    on_list: Boolean(listed),
    correct: s.correct_answers || 0,
    total: s.total_questions_answered || 0,
  };
}

/**
 * Every child counted on this class code (each child's first finish, the rule
 * the league and the report use), children not on the class list first so the
 * teacher sees what may need fixing. Nothing beyond first names + roll numbers.
 */
async function whoPlayed(body = {}) {
  requireOn();
  const ctx = await resolveCode(body.code);
  requireTeacher(body, ctx);
  if ((await IdRoster.identityMode()) === 'v2') return whoPlayedV2(ctx);
  const roster = await Roster.loadRoster(ctx.teacherUserId, { grade: await gradeOf(ctx.quizId) });
  const { data } = await supabase.from('quiz_sessions')
    .select('id, student_id, student_name, user_id, status, correct_answers, total_questions_answered, completed_at, created_at')
    .eq('share_code_id', ctx.shareCodeId).is('invited_by_student_id', null).eq('status', 'completed');
  const counted = oneAttemptPerChild(excludeSelfTests(data || [], ctx.teacherUserId), { rule: 'first_completed' })
    .filter((s) => s.student_id);
  const rows = counted.map((s) => whoRow(s, roster, ctx.lang))
    .sort((a, b) => (a.on_list - b.on_list) || ((a.roll || 0) - (b.roll || 0)) || a.first.localeCompare(b.first));
  // The class this quiz is for (its list, else its grade's): who of it has not played yet.
  const { one } = await oneClass(ctx, null);
  const done = new Set(counted.map((s) => s.student_id));
  const notPlayed = one && one.lists.length
    ? one.kids.filter((k) => !done.has(k.id))
      .map((k) => ({ first: firstName(Roster.displayName(k, ctx.lang)), roll: k.roll_number != null ? Number(k.roll_number) : null }))
      .sort((a, b) => ((a.roll || 0) - (b.roll || 0)) || a.first.localeCompare(b.first))
    : null;
  const total = (await loadQuestions(ctx.quizId)).length || Math.max(0, ...rows.map((r) => r.total));
  const avg = rows.length ? Math.round((rows.reduce((n, r) => n + r.correct, 0) / rows.length) * 10) / 10 : null;
  return {
    roster: Boolean(roster),
    summary: {
      played: rows.length,
      on_list: rows.filter((r) => r.on_list).length,
      of: one && one.lists.length ? one.kids.length : null,
      avg, total,
      hardest: await hardestQuestion(ctx.quizId, counted.map((s) => s.id)),
    },
    not_played: notPlayed,
    rows,
  };
}

/**
 * The question most counted children missed: { n (its place in the quiz, 1-based), missed }.
 * Null with fewer than two finishers or when nobody missed anything (nothing to point at).
 */
async function hardestQuestion(quizId, sessionIds) {
  if (sessionIds.length < 2) return null;
  try {
    const [questions, { data }] = await Promise.all([
      loadQuestions(quizId),
      supabase.from('quiz_answers').select('session_id, question_id, is_correct').in('session_id', sessionIds),
    ]);
    let best = null;
    questions.forEach((q, i) => {
      const missed = (data || []).filter((a) => a.question_id === q.id && a.is_correct === false).length;
      if (missed && (!best || missed > best.missed)) best = { n: i + 1, missed };
    });
    return best;
  } catch { return null; }
}

/**
 * Move one of this code's sessions to the right class-list child: { ref, roll }
 * answers "is this <first name>?" (409 is_this_you), { ref, chip } moves it. The
 * report and the league recompute each child's first finish on read, so a move
 * onto a child who already finished keeps that child's earlier finish.
 */
async function fixWho(body = {}) {
  requireOn();
  const ctx = await resolveCode(body.code);
  requireTeacher(body, ctx);
  if ((body.studentId || body.add === true) && (await IdRoster.identityMode()) === 'v2') return fixWhoV2(ctx, body);
  const quizGrade = await gradeOf(ctx.quizId);
  const roster = await Roster.loadRoster(ctx.teacherUserId, { grade: quizGrade });
  if (!roster) fail(400, 'bad_request', { why: 'no_class_list' });
  const { data: s } = await supabase.from('quiz_sessions')
    .select('id, student_id, student_name, user_id, share_code_id, invited_by_student_id, status, correct_answers, total_questions_answered')
    .eq('id', String(body.ref || '')).eq('share_code_id', ctx.shareCodeId).maybeSingle();
  if (!s || s.user_id || s.invited_by_student_id || !s.student_id) fail(404, 'not_found');
  if (body.roll != null && !body.chip) {
    const roll = Roster.cleanRoll(body.roll);
    if (!roll) fail(400, 'bad_request', { why: 'roll' });
    const found = Roster.byRoll(roster, roll, quizGrade);
    if (!found.length) fail(404, 'roll_unknown');
    fail(409, 'is_this_you', { candidates: found.map((f) => rosterChip(ctx, f)) });
  }
  const want = String(body.chip || '');
  const target = roster.kids.find((k) => T.chipId(ctx.shareCodeId, k.id) === want);
  if (!target) fail(404, 'chip_unknown');
  const patch = { student_id: target.id, student_name: target.student_name, student_class: Roster.classOf(roster, target) };
  const { error } = await supabase.from('quiz_sessions').update(patch).eq('id', s.id).eq('share_code_id', ctx.shareCodeId);
  if (error) fail(502, 'db_unavailable');
  logEvent('web_quiz.identity_fixed', { sessionId: s.id, shareCodeId: ctx.shareCodeId, fromListed: roster.kids.some((k) => k.id === s.student_id) });
  return { ok: true, row: whoRow({ ...s, ...patch }, roster, ctx.lang) };
}

function isPreviewFor(p, ctx) {
  const tok = T.verify(p, 'p');
  return Boolean(tok && tok.sc === ctx.shareCodeId && tok.t === ctx.teacherUserId);
}

/**
 * A child's first name, one way on every screen of a page: on an Urdu quiz a child on the
 * teacher's class list is named with the list's Urdu spelling (Roster.displayName, the rule
 * "Are you…?" and Who-played use), anyone else by the name the session carries. One read of the
 * students rows on an Urdu quiz; an English quiz reads nothing.
 */
async function shownNames(lang, studentIds) {
  const ids = [...new Set((studentIds || []).filter(Boolean))];
  const names = new Map();
  if (lang === 'ur' && ids.length) {
    try {
      const { data } = await supabase.from('students').select('id, student_name, student_name_urdu').in('id', ids);
      (data || []).forEach((k) => names.set(k.id, Roster.displayName(k, lang)));
    } catch { /* the session's name, never a failed screen */ }
  }
  return (studentId, name) => firstName((studentId && names.get(studentId)) || name);
}

async function codeLanguage(shareCodeId) {
  try {
    const { data } = await supabase.from('quiz_share_codes').select('language').eq('id', shareCodeId).maybeSingle();
    return clampLanguage(data && data.language);
  } catch { return clampLanguage(null); }
}

/**
 * A challenge's outcome from the side of `mine`: compares the two scores as
 * shares (6/8 ties 3/4). An empty score never wins. Pure.
 */
function challengeOutcome(mine, theirs) {
  const a = (Number(mine && mine.correct) || 0) * (Number(theirs && theirs.total) || 0);
  const b = (Number(theirs && theirs.correct) || 0) * (Number(mine && mine.total) || 0);
  if (!(Number(mine && mine.total) > 0)) return 'lose';
  if (a > b) return 'win';
  return a === b ? 'tie' : 'lose';
}

/** The friend who sent a challenge link: their first counted score on the class code. */
async function challengeOf(ctx) {
  const { data: rows } = await supabase.from('quiz_sessions')
    .select('id, student_id, student_name, status, correct_answers, total_questions_answered, completed_at, created_at')
    .eq('share_code_id', ctx.shareCodeId).eq('student_id', ctx.invitedByStudentId).eq('status', 'completed');
  const [best] = oneAttemptPerChild(rows || [], { rule: 'first_completed' });
  if (!best) return null;
  const nameOf = await shownNames(ctx.lang, [best.student_id]);
  return { first: nameOf(best.student_id, best.student_name), correct: best.correct_answers || 0, total: best.total_questions_answered || 0 };
}

// ─── E3 the session ─────────────────────────────────────────────────────────

const SESSION_COLS = 'id, quiz_id, student_id, student_name, user_id, share_code_id, status, device_ref, '
  + 'correct_answers, total_questions_answered, mastery_percentage, completed_at, created_at, expires_at, invited_by_student_id';

async function sessionFromToken(st) {
  const tok = T.verify(st, 's');
  if (!tok || !tok.sid) fail(401, 'bad_token');
  const { data: s, error } = await supabase.from('quiz_sessions').select(SESSION_COLS).eq('id', tok.sid).maybeSingle();
  if (error) fail(502, 'db_unavailable');
  if (!s) fail(401, 'bad_token');
  return { s, tok };
}

async function answeredIds(sessionId) {
  const { data } = await supabase.from('quiz_answers').select('question_id, selected_option, is_correct').eq('session_id', sessionId);
  return data || [];
}

function cleanName(raw) {
  // eslint-disable-next-line no-control-regex
  const s = String(raw || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  return s.length >= 1 && s.length <= 40 ? s : null;
}

/** Earlier completed attempts by this child on this class code (the first one counts). */
async function priorFinish(shareCodeId, studentId, excludeId = null) {
  if (!studentId) return null;
  const { data } = await supabase.from('quiz_sessions').select('id, device_ref, status, completed_at, created_at, student_id, correct_answers, total_questions_answered')
    .eq('share_code_id', shareCodeId).eq('student_id', studentId).eq('status', 'completed');
  const rows = (data || []).filter((r) => r.id !== excludeId);
  const [first] = oneAttemptPerChild(rows, { rule: 'first_completed' });
  return first || null;
}

async function countJoin(shareCodeId) {
  try {
    const { error } = await supabase.rpc('increment_share_code_uses', { code_id: shareCodeId });
    if (error) logToFile('⚠️ web-quiz: increment_share_code_uses failed', { shareCodeId, error: error.message });
  } catch (e) {
    logToFile('⚠️ web-quiz: increment_share_code_uses threw', { shareCodeId, error: e.message });
  }
}

async function startSession(body = {}) {
  requireOn();
  const ctx = await resolveCode(body.code);
  const deviceRef = T.cleanDeviceRef(body.device_ref) || T.newDeviceRef();

  // A returning page resumes its own open session instead of starting another.
  if (body.resume_st) {
    const tok = T.verify(body.resume_st, 's');
    if (tok && tok.sc === ctx.shareCodeId) {
      const { data: s } = await supabase.from('quiz_sessions').select(SESSION_COLS).eq('id', tok.sid).maybeSingle();
      if (s && s.status === 'in_progress' && (!s.expires_at || new Date(s.expires_at) > new Date())) {
        const answered = await answeredIds(s.id);
        const prior = await priorFinish(ctx.shareCodeId, s.student_id, s.id);
        const nameOf = await shownNames(ctx.lang, [s.student_id]);
        return {
          st: body.resume_st, device_ref: tok.d || deviceRef,
          ...countedFor(prior, tok.d || deviceRef, Boolean(s.user_id)),
          resume: { answered: answered.map((a) => a.question_id) },
          child: s.student_id ? { chip: T.chipId(ctx.shareCodeId, s.student_id), first: nameOf(s.student_id, s.student_name), animal: T.animalFor(s.student_id) } : null,
        };
      }
    }
  }

  let student = null;
  let userId = null;
  let takerName = null;
  let takerClass = null;
  // Identity v2 (app_settings web_quiz_identity = 'v2'); null = today's path, untouched.
  const idn = body.p ? null : await identityV2(ctx);
  let found = null;
  let resolved = null;
  if (body.p) {
    if (!isPreviewFor(body.p, ctx)) fail(401, 'bad_token');
    userId = ctx.teacherUserId;           // the self-test marker: never a child
    takerName = ctx.parent.teacher_name || null;
  } else if (body.roll != null) {
    // "What is your roll number?" -> "Are you <first name>?": the page confirms with the chip.
    // A roll number resolves only within this quiz's one class list.
    const { roster, grade: quizGrade, ask, one } = await oneClass(ctx, body.list);
    if (!roster) fail(400, 'bad_request', { why: 'who' });
    const roll = Roster.cleanRoll(body.roll);
    if (!roll) fail(400, 'bad_request', { why: 'roll' });
    if (ask) fail(409, 'which_class', { classes: ask });
    const found = Roster.byRoll(one, roll, quizGrade);
    logEvent('web_quiz.roll_lookup', { shareCodeId: ctx.shareCodeId, matches: found.length });
    if (!found.length) fail(404, 'roll_unknown');
    fail(409, 'is_this_you', { candidates: found.map((f) => rosterChip(ctx, f)) });
  } else if (body.chip && idn && (found = await chipInClass(ctx, idn, String(body.chip), body.list))) {
    // v2: "Yes, it's me" on the one card, or a remembered child of the hand-out's class.
    student = { id: found.kid.id, student_name: found.kid.student_name, self_reported_class: found.cls.label || null };
    resolved = { via: viaOf(body.via, 'remembered'), classBound: found.bound, provisional: false };
  } else if (body.chip) {
    const want = String(body.chip);
    const roster = await Roster.loadRoster(ctx.teacherUserId, { grade: await gradeOf(ctx.quizId) });
    const fromRoster = roster ? roster.kids.find((k) => T.chipId(ctx.shareCodeId, k.id) === want) : null;
    if (fromRoster) {
      student = { id: fromRoster.id, student_name: fromRoster.student_name, self_reported_class: Roster.classOf(roster, fromRoster) };
    } else {
      const chips = await classChips(ctx);
      const hit = chips.find((c) => c.chip === want) || chips.find((c) => c.aliases.has(want));
      if (!hit) fail(404, 'chip_unknown');
      const { data: st } = await supabase.from('students').select('id, student_name, self_reported_class').eq('id', hit.studentId).maybeSingle();
      student = st || { id: hit.studentId, student_name: hit.name };
      // A class-list child remembered from an earlier code of this teacher keeps the list's class.
      const listed = roster ? roster.kids.find((k) => k.id === hit.studentId) : null;
      if (listed) student = { ...student, self_reported_class: Roster.classOf(roster, listed) };
    }
  } else if (body.from_st) {
    // "Watch another video": the session token of the quiz the child just played says who they
    // are. Accepted only for a session on a code of the same teacher.
    const tok = T.verify(body.from_st, 's');
    if (!tok || !tok.sid) fail(401, 'bad_token');
    const { data: prev } = await supabase.from('quiz_sessions').select('student_id, share_code_id, user_id').eq('id', tok.sid).maybeSingle();
    if (!prev || !prev.student_id || prev.user_id) fail(401, 'bad_token');
    const { data: prevCode } = await supabase.from('quiz_share_codes').select('teacher_user_id').eq('id', prev.share_code_id).maybeSingle();
    if (!prevCode || prevCode.teacher_user_id !== ctx.teacherUserId) fail(401, 'bad_token');
    const { data: st } = await supabase.from('students').select('id, student_name, self_reported_class').eq('id', prev.student_id).maybeSingle();
    if (!st) fail(401, 'bad_token');
    student = st;
    // A class-list child keeps the list's class (as the chip branch does).
    const roster = await Roster.loadRoster(ctx.teacherUserId, { grade: await gradeOf(ctx.quizId) });
    const listed = roster ? roster.kids.find((k) => k.id === st.id) : null;
    if (listed) student = { ...student, self_reported_class: Roster.classOf(roster, listed) };
  } else if (body.new && typeof body.new === 'object' && idn) {
    ({ student, resolved } = await newChildV2(ctx, body, idn));
  } else if (body.new && typeof body.new === 'object') {
    const name = cleanName(body.new.name);
    if (!name) fail(400, 'bad_request', { why: 'name' });
    const cls = body.new.cls == null ? null : String(body.new.cls).replace(/[^\p{L}\p{N} -]/gu, '').slice(0, 20) || null;
    if (!body.new.force) {
      const mine = norm(firstName(name));
      const { roster, grade: quizGrade, ask, one } = await oneClass(ctx, body.list);
      let candidates;
      if (roster) {
        // With a class list, a typo still finds the child ("Aysha" -> Ayesha) — but only in this
        // quiz's class: a name that class does not have is a new child, never another class's child.
        if (ask) fail(409, 'which_class', { classes: ask });
        candidates = Roster.byName(one, firstName(name), quizGrade).map((f) => rosterChip(ctx, f, one));
      } else {
        const chips = await classChips(ctx);
        candidates = chips.filter((c) => norm(c.first) === mine).map(publicChip);
      }
      candidates = candidates.slice(0, Roster.MAX_CANDIDATES);
      if (candidates.length) fail(409, 'maybe_you', { candidates });
    }
    const { data: created, error } = await supabase.from('students').insert({
      student_name: name, self_reported_class: cls, enrolled_by_user_id: ctx.teacherUserId || null,
      phone: null, list_id: null,
    }).select('id, student_name, self_reported_class').single();
    if (error || !created) {
      logToFile('❌ web-quiz: could not create student', { error: error && error.message }, 'error');
      fail(502, 'db_unavailable');
    }
    student = created;
  } else {
    fail(400, 'bad_request', { why: 'who' });
  }

  if (student) {
    takerName = student.student_name;
    takerClass = student.self_reported_class || null;
  }
  const prior = student ? await priorFinish(ctx.shareCodeId, student.id) : null;

  const { data: session, error: sErr } = await supabase.from('quiz_sessions').insert({
    quiz_id: ctx.quizId,
    user_id: userId,
    student_id: student ? student.id : null,
    // A child opening their OWN challenge link (v2) plays for their class, not as their own guest.
    invited_by_student_id: idn && student && student.id === ctx.invitedByStudentId ? null : ctx.invitedByStudentId,
    student_name: takerName,
    student_class: takerClass,
    share_code_id: ctx.shareCodeId,
    source: 'share_link',
    parent_phone: null,
    device_ref: deviceRef,
    status: 'in_progress',
    expires_at: new Date(Date.now() + T.SESSION_TTL_S * 1000).toISOString(),
  }).select('id').single();
  if (sErr || !session) {
    logToFile('❌ web-quiz: could not create session', { quizId: ctx.quizId, error: sErr && sErr.message }, 'error');
    fail(502, 'db_unavailable');
  }

  await countJoin(ctx.shareCodeId);
  let quizSource = null;
  try {
    const { data: q } = await supabase.from('quizzes').select('quiz_source').eq('id', ctx.quizId).maybeSingle();
    quizSource = (q && q.quiz_source) || null;
  } catch { /* a missing label, never a stopped quiz */ }
  Funnel.emit('child_joined', {
    quiz_id: ctx.quizId, session_id: session.id, share_code_id: ctx.shareCodeId, source: quizSource, channel: 'web',
    ...(userId ? { kind: 'self_test' } : {}),
  });
  // The same call a WhatsApp child's join makes (video-quiz-share startForStudent):
  // the first join of a code schedules the teacher's 12-hour report; later
  // joins are de-duplicated inside scheduleForShareCode.
  try {
    // A "watch another video" code was never sent by the teacher: no report of its own (a paid message).
    if (!ctx.moreVideosOf) await require('./video-quiz-report.service').scheduleForShareCode(ctx.shareCodeId);
  } catch (e) {
    logToFile('⚠️ web-quiz: report scheduling failed (the quiz still runs)', { shareCodeId: ctx.shareCodeId, error: e.message });
  }
  const counted = countedFor(prior, deviceRef, Boolean(userId));
  if (resolved) logEvent('web_quiz.identity_resolved', { shareCodeId: ctx.shareCodeId, sessionId: session.id, ...resolved });
  logEvent('web_quiz.session_started', {
    sessionId: session.id, shareCodeId: ctx.shareCodeId, quizId: ctx.quizId,
    preview: Boolean(userId), returning: Boolean(body.chip || body.from_st), counted: counted.counted,
    ...(ctx.moreVideosOf ? { moreVideos: true } : {}),
    // How the page identified the child (roll / name / remembered / chips / new): measures each path.
    via: /^[a-z_]{1,16}$/.test(String(body.via || '')) ? body.via : null,
  });
  const nameOf = await shownNames(ctx.lang, [student && student.id]);
  return {
    st: T.signSession({ sessionId: session.id, deviceRef, shareCodeId: ctx.shareCodeId }),
    device_ref: deviceRef,
    ...counted,
    resume: { answered: [] },
    child: student ? { chip: T.chipId(ctx.shareCodeId, student.id), first: nameOf(student.id, student.student_name), animal: T.animalFor(student.id) } : null,
  };
}

function countedFor(prior, deviceRef, preview) {
  if (preview) return { counted: false, reason: 'preview' };
  if (!prior) return { counted: true };
  return { counted: false, reason: prior.device_ref && prior.device_ref === deviceRef ? 'already_finished' : 'finished_elsewhere' };
}

// ─── identity v2: name first, inside the hand-out's one class ──────────────

const NONE_CLASS = { state: 'none', class: null, classes: [], bound: null };
const VIA = ['remembered', 'hub', 'name', 'full_name', 'father', 'number', 'new', 'preview'];
const BOUND = ['code', 'quiz', 'single', 'grade', 'teacher_ask', 'child_ask', 'none'];
const viaOf = (v, dflt) => (VIA.includes(String(v || '')) ? String(v) : dflt);
const boundOf = (b) => (BOUND.includes(String(b || '')) ? String(b) : 'none');
const ARABIC_SCRIPT = /[؀-ۿݐ-ݿ]/;

/**
 * The v2 identity context of a code, or null when the setting is not 'v2'. An
 * invited friend (a challenge code) never meets the class roster: no class, no
 * matching, a provisional child (their class is not the inviter's).
 */
async function identityV2(ctx) {
  if ((await IdRoster.identityMode()) !== 'v2') return null;
  if (ctx.invitedByStudentId) return { invited: true, resolved: NONE_CLASS };
  try {
    const resolved = await Identity.resolveQuizClass({
      teacherUserId: ctx.teacherUserId, quizId: ctx.quizId, shareCodeId: ctx.moreVideosOf || ctx.shareCodeId,
    });
    return { invited: false, resolved: resolved || NONE_CLASS };
  } catch (e) {
    logToFile('⚠️ web-quiz: class resolution failed — no roster for this start', { shareCodeId: ctx.shareCodeId, error: e.message });
    return { invited: false, resolved: NONE_CLASS };
  }
}

const askOf = (ctx, classes) => (classes || []).map((c) => ({ key: IdRoster.classKeyV2(ctx.shareCodeId, c), label: c.label || '' }));

/** E2's `cls.identity`: how the page should ask. Never a name, never a class id. */
async function identityBoot(ctx, idn) {
  const r = idn.resolved;
  let roster = !idn.invited && r.state === 'ambiguous';
  if (!idn.invited && r.state === 'known') roster = Boolean(((await IdRoster.rosterOf(r.class)) || []).length);
  return {
    mode: 'v2',
    class: {
      state: r.state,
      label: r.state === 'known' && r.class ? r.class.label || null : null,
      ask: r.state === 'ambiguous' ? askOf(ctx, r.classes) : null,
    },
    roster,
    invited: Boolean(idn.invited),
  };
}

/** The class a v2 start plays against: the resolved one, or the one the child chose (S1). Throws which_class. */
function classForStart(ctx, idn, list, { ask = true } = {}) {
  const r = idn.resolved;
  if (r.state === 'known') return { cls: r.class, chosen: false, bound: boundOf(r.bound), only: r.bound === 'single' };
  if (r.state !== 'ambiguous') return { cls: null, chosen: false, bound: 'none' };
  const key = list == null ? '' : String(list);
  if (key === 'none') return { cls: null, chosen: true, bound: 'none' };
  const cls = key ? r.classes.find((c) => IdRoster.classKeyV2(ctx.shareCodeId, c) === key) : null;
  if (cls) return { cls, chosen: true, bound: 'child_ask' };
  if (!ask) return null;
  logEvent('web_quiz.identity_step', { shareCodeId: ctx.shareCodeId, step: 'class', hits: r.classes.length });
  return fail(409, 'which_class', { classes: askOf(ctx, r.classes) });
}

/** A chip (a card the child tapped, or a remembered one) that is a child of the hand-out's class. */
async function chipInClass(ctx, idn, want, list) {
  if (idn.invited) return null;
  const r = idn.resolved;
  const pick = r.state === 'ambiguous' && list != null ? classForStart(ctx, idn, list, { ask: false }) : null;
  const pool = pick && pick.cls ? [pick] : r.state === 'known' ? [classForStart(ctx, idn, null)]
    : r.state === 'ambiguous' ? r.classes.map((c) => ({ cls: c, bound: 'child_ask' })) : [];
  for (const p of pool) {
    const kids = (await IdRoster.rosterOf(p.cls)) || [];
    const kid = kids.find((k) => k.ids.some((id) => T.chipId(ctx.shareCodeId, id) === want));
    if (kid) return { kid, cls: p.cls, bound: p.bound };
  }
  return null;
}

/** The first name a card or a question shows: as the child typed it in Urdu script, else as the list spells it. */
function shownFirstV2(ctx, kid, typed) {
  if (ctx.lang === 'ur' && kid.nameUrdu) return firstName(kid.nameUrdu);
  const t = firstName(typed);
  return ARABIC_SCRIPT.test(t) ? t : kid.first;
}

/** An "I don't know" (explicit null), an answer, or not asked (absent). */
function tiebreakers(n) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(n, k);
  ['full_name', 'father'].forEach((k) => {
    if (!has(k)) return;
    if (n[k] == null) { out[k] = null; return; }
    out[k] = cleanName(n[k]);
    if (!out[k]) fail(400, 'bad_request', { why: 'name' });
  });
  if (has('number')) {
    if (n.number == null) out.number = null;
    else if (/^\d{1,3}$/.test(String(n.number).trim())) out.number = Number(String(n.number).trim());
    else fail(400, 'bad_request', { why: 'number' });
  }
  return out;
}

/**
 * "What is your name?" → one of: which_class, ask_more (the child's own full
 * name / father's name / list number), is_this_you (exactly ONE card), not_found
 * — or a provisional child of the hand-out, created here. Never a list of children.
 */
async function newChildV2(ctx, body, idn) {
  const n = body.new;
  const name = cleanName(n.name);
  if (!name) fail(400, 'bad_request', { why: 'name' });
  const answers = tiebreakers(n);
  const step = (s, hits) => logEvent('web_quiz.identity_step', { shareCodeId: ctx.shareCodeId, step: s, hits });
  const provisional = async (label, bound) => {
    step('provisional', 0);
    const { data: created, error } = await supabase.from('students').insert({
      student_name: name, self_reported_class: label || null, enrolled_by_user_id: ctx.teacherUserId || null, phone: null, list_id: null,
    }).select('id, student_name, self_reported_class').single();
    if (error || !created) {
      logToFile('❌ web-quiz: could not create student', { error: error && error.message }, 'error');
      fail(502, 'db_unavailable');
    }
    return { student: created, resolved: { via: 'new', classBound: bound, provisional: true } };
  };
  if (idn.invited) return provisional(null, 'none');
  const { cls, chosen, bound, only } = classForStart(ctx, idn, body.list);
  const label = cls ? cls.label || null : null;
  const kids = cls ? await IdRoster.rosterOf(cls) : null;
  if (!kids || !kids.length || n.force) return provisional(label, bound);
  // The class is named back to the child only when it tells something: not for a teacher's only class.
  const clsLine = label && (chosen || !only) ? { cls: label } : {};
  const m = Identity.match(kids, name, answers);
  if (m.outcome === 'one') {
    step('confirm', 1);
    const card = { chip: T.chipId(ctx.shareCodeId, m.kid.id), first: shownFirstV2(ctx, m.kid, name), animal: T.animalFor(m.kid.id) };
    fail(409, 'is_this_you', { candidates: [chosen && label ? { ...card, cls: label } : card] });
  }
  if (m.outcome === 'ask') {
    step(m.need, m.hits.length);
    fail(409, 'ask_more', { need: m.need, first: shownFirstV2(ctx, m.hits[0], name), ...clsLine });
  }
  step('name', 0);
  return fail(409, 'not_found', { typed: name, ...clsLine });
}

/** whoPlayed under v2: today's rows / not_played / summary, from the hand-out's class, plus provisional. */
async function whoPlayedV2(ctx) {
  const na = await IdRoster.nonAttempters({ shareCodeId: ctx.shareCodeId });
  const provisional = na.provisional.map((p) => ({ ref: p.sessionId, first: firstName(p.typed), correct: p.correct, total: p.total }));
  const rows = [
    ...provisional.map((p) => ({ ref: p.ref, first: p.first, roll: null, on_list: false, correct: p.correct, total: p.total })),
    ...na.played.map((p) => ({ ref: p.sessionId, first: p.first, roll: p.number, on_list: p.onList, correct: p.correct, total: p.total })),
  ].sort((a, b) => (a.on_list - b.on_list) || ((a.roll || 0) - (b.roll || 0)) || a.first.localeCompare(b.first));
  const total = (await loadQuestions(ctx.quizId)).length || Math.max(0, ...rows.map((r) => r.total));
  const avg = rows.length ? Math.round((rows.reduce((x, r) => x + r.correct, 0) / rows.length) * 10) / 10 : null;
  return {
    roster: na.class.state === 'known',
    class: { state: na.class.state, label: na.class.label, classes: na.class.classes },
    summary: {
      played: rows.length, on_list: rows.filter((r) => r.on_list).length, of: na.class.of, avg, total,
      hardest: await hardestQuestion(ctx.quizId, rows.map((r) => r.ref)),
    },
    not_played: na.notPlayed ? na.notPlayed.map((k) => ({ studentId: k.studentId, first: k.first, roll: k.number })) : null,
    rows,
    provisional,
  };
}

/** The teacher's reconcile under v2: { ref, studentId } moves a finish onto a class child; { ref, add } enrols the typed child. */
async function fixWhoV2(ctx, body) {
  const r = await Identity.resolveQuizClass({ teacherUserId: ctx.teacherUserId, quizId: ctx.quizId, shareCodeId: ctx.shareCodeId });
  if (!r || r.state !== 'known') fail(409, 'which_class', { classes: askOf(ctx, (r && r.classes) || []) });
  const kids = (await IdRoster.rosterOf(r.class)) || [];
  const { data: s } = await supabase.from('quiz_sessions')
    .select('id, student_id, student_name, user_id, share_code_id, invited_by_student_id, status, correct_answers, total_questions_answered')
    .eq('id', String(body.ref || '')).eq('share_code_id', ctx.shareCodeId).maybeSingle();
  if (!s || s.user_id || s.invited_by_student_id || !s.student_id) fail(404, 'not_found');
  const label = r.class.label || null;
  const row = (patch, kid) => ({ ref: s.id, first: kid ? kid.first : firstName(patch.student_name || s.student_name), roll: kid ? kid.number : null,
    on_list: Boolean(kid), correct: s.correct_answers || 0, total: s.total_questions_answered || 0 });
  if (body.studentId) {
    const target = IdRoster.findKid(kids, String(body.studentId));
    if (!target) fail(404, 'student_unknown');
    const patch = { student_id: target.id, student_name: target.student_name, student_class: label };
    const { error } = await supabase.from('quiz_sessions').update(patch).eq('id', s.id).eq('share_code_id', ctx.shareCodeId);
    if (error) fail(502, 'db_unavailable');
    logEvent('web_quiz.identity_fixed', { sessionId: s.id, shareCodeId: ctx.shareCodeId, fromListed: Boolean(IdRoster.findKid(kids, s.student_id)) });
    return { ok: true, row: row(patch, target) };
  }
  // { add: true }: the typed child joins the class list (ClassService, the same enrolment /roster makes).
  if (IdRoster.findKid(kids, s.student_id)) return { ok: true, already: true, row: row({}, IdRoster.findKid(kids, s.student_id)) };
  if (!r.class.id) fail(400, 'bad_request', { why: 'no_class' });
  const ClassService = require('../classes/class.service');
  const out = await ClassService.enrollExistingStudent({ classId: r.class.id, teacherUserId: ctx.teacherUserId, studentId: s.student_id });
  if (out.error === 'not_assigned') fail(403, 'not_your_class');
  if (out.error) fail(502, 'db_unavailable');
  await supabase.from('quiz_sessions').update({ student_class: label }).eq('id', s.id).eq('share_code_id', ctx.shareCodeId);
  IdRoster._forgetClass(r.class.id);
  logEvent('web_quiz.identity_enrolled', { sessionId: s.id, shareCodeId: ctx.shareCodeId });
  return { ok: true, row: { ...row({}, null), on_list: true } };
}

/** The teacher (preview `p`, or the report token `tr` once M3's verifier lands) of this code. */
function requireTeacherOf(body, ctx) {
  if (body.p && isPreviewFor(body.p, ctx)) return;
  const tr = body.tr ? T.verify(body.tr, 'tr') : null; // M3's teacher-report token: same teacher, any of their codes
  if (tr && tr.t === ctx.teacherUserId) return;
  fail(401, 'bad_token');
}

/**
 * POST /who/class — the teacher says which class an unbound hand-out was for
 * (the report's "Which class was this for?"). Writes quiz_share_codes.class_id,
 * so the children's page is bound from then on.
 */
async function whoClass(body = {}) {
  requireOn();
  const ctx = await resolveCode(body.code);
  requireTeacherOf(body, ctx);
  const all = await Identity.resolveQuizClass({ teacherUserId: ctx.teacherUserId });
  const cls = ((all && all.classes) || []).find((c) => IdRoster.classKeyV2(ctx.shareCodeId, c) === String(body.key || ''));
  if (!cls) fail(404, 'class_unknown');
  if (!cls.id) fail(400, 'bad_request', { why: 'no_class' });
  const { error } = await supabase.from('quiz_share_codes').update({ class_id: cls.id }).eq('id', ctx.shareCodeId);
  if (error && error.code === '42703') fail(503, 'not_ready');
  if (error) fail(502, 'db_unavailable');
  logEvent('web_quiz.identity_class_bound', { shareCodeId: ctx.shareCodeId, by: body.p ? 'preview' : 'report' });
  return { ok: true, class: { label: cls.label || '' } };
}

// ─── E4 answers ─────────────────────────────────────────────────────────────

async function recordAnswers(body = {}) {
  requireOn();
  const { s } = await sessionFromToken(body.st);
  const list = Array.isArray(body.a) ? body.a : null;
  if (!list || !list.length || list.length > 20) fail(400, 'bad_request', { why: 'a' });
  const out = { recorded: [], dup: [], unknown: [] };
  if (s.status === 'completed') {
    // A finished quiz takes no more answers; the page's late flush is harmless.
    list.forEach((a) => out.dup.push(String(a && a.qid)));
    return { ...out, closed: true };
  }
  const questions = await loadQuestions(s.quiz_id);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const already = new Set((await answeredIds(s.id)).map((r) => r.question_id));
  const fresh = [];
  for (const a of list) {
    const qid = a && typeof a.qid === 'string' ? a.qid : null;
    const q = qid ? byId.get(qid) : null;
    const slot = a && typeof a.slot === 'string' ? a.slot.toUpperCase() : '';
    if (!q || !SLOT_RX.test(slot)) { out.unknown.push(String(qid)); continue; }
    if (already.has(qid) || fresh.some((r) => r.question_id === qid)) { out.dup.push(qid); continue; }
    const ms = Number(a.ms);
    fresh.push({
      session_id: s.id, question_id: qid, selected_option: slot,
      is_correct: WebItems.isCorrect(q, slot),
      response_time_seconds: Number.isFinite(ms) && ms >= 0 ? Math.min(3600, Math.round(ms / 1000)) : null,
    });
  }
  if (!fresh.length) return out;
  // A phone back from offline sends its whole queue at once: one insert, not one per answer.
  const { error } = await supabase.from('quiz_answers').insert(fresh.length === 1 ? fresh[0] : fresh);
  if (!error) {
    fresh.forEach((r) => out.recorded.push(r.question_id));
    return out;
  }
  if (error.code !== '23505') {
    logToFile('❌ web-quiz: answer insert failed', { sessionId: s.id, error: error.message }, 'error');
    fail(502, 'db_unavailable');
  }
  // The unique (session, question) index refused the batch: another flush landed some of it
  // first (a duplicate is an answer already recorded — the first one is the score). Re-read
  // and write the rest one row at a time.
  const landed = new Set((await answeredIds(s.id)).map((r) => r.question_id));
  for (const r of fresh) {
    if (landed.has(r.question_id)) { out.dup.push(r.question_id); continue; }
    const { error: e1 } = await supabase.from('quiz_answers').insert(r);
    if (e1 && e1.code === '23505') { out.dup.push(r.question_id); continue; }
    if (e1) {
      logToFile('❌ web-quiz: answer insert failed', { sessionId: s.id, error: e1.message }, 'error');
      fail(502, 'db_unavailable');
    }
    out.recorded.push(r.question_id);
  }
  return out;
}

// ─── E5 finish ──────────────────────────────────────────────────────────────

/** The challenge code this child forwards: one per child per class code, reused. */
async function challengeCodeFor(s) {
  if (!s.student_id || s.user_id) return null;
  try {
    const { data: have } = await supabase.from('quiz_share_codes').select('code, active, expires_at')
      .eq('invited_by_student_id', s.student_id).eq('parent_share_code_id', s.share_code_id).limit(1);
    const live = (have || []).find((c) => c.active !== false && (!c.expires_at || new Date(c.expires_at) > new Date()));
    if (live) return live.code;
    const { data: parent } = await supabase.from('quiz_share_codes')
      .select('id, quiz_id, video_id, teacher_user_id, teacher_name, topic, language').eq('id', s.share_code_id).maybeSingle();
    if (!parent) return null;
    const { randomCode } = require('./video-quiz-share.service');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { data, error } = await supabase.from('quiz_share_codes').insert({
        code: randomCode(), quiz_id: parent.quiz_id, teacher_user_id: parent.teacher_user_id,
        video_id: parent.video_id, teacher_name: parent.teacher_name, topic: parent.topic, language: parent.language,
        invited_by_student_id: s.student_id, parent_share_code_id: parent.id,
        expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      }).select('id, code').single();
      if (!error && data) return data.code;
      if (error && error.code !== '23505') break;
    }
  } catch (e) {
    logToFile('⚠️ web-quiz: challenge code unavailable', { error: e.message });
  }
  return null;
}

async function finishSession(body = {}) {
  requireOn();
  const { s, tok } = await sessionFromToken(body.st);
  const questions = await loadQuestions(s.quiz_id);
  const answers = await answeredIds(s.id);
  const byQ = new Map(answers.map((a) => [a.question_id, a]));
  const served = questions.filter((q) => byQ.has(q.id));
  const total = served.length;
  const correct = served.filter((q) => byQ.get(q.id).is_correct).length;
  // Today's floors (video-quiz.service finish): nothing answered is not a
  // score, and fewer than half the quiz is started-but-unfinished.
  const need = Math.ceil(questions.length / 2);
  if (!total || total < need) fail(409, 'too_few_answered', { answered: total, need });
  const pct = Math.round((correct / total) * 100);
  const level = levelFor(pct);

  if (s.status !== 'completed') {
    const { error } = await supabase.from('quiz_sessions').update({
      status: 'completed', total_questions_answered: total, correct_answers: correct,
      mastery_percentage: pct, mastery_level: level, completed_at: new Date().toISOString(),
    }).eq('id', s.id);
    if (error) {
      logToFile('❌ web-quiz: could not complete session', { sessionId: s.id, error: error.message }, 'error');
      fail(502, 'db_unavailable');
    }
    Funnel.emit('child_completed', {
      quiz_id: s.quiz_id, session_id: s.id, share_code_id: s.share_code_id, channel: 'web', pct,
      ...(s.user_id ? { kind: 'self_test' } : {}),
    });
    logEvent('web_quiz.session_completed', { sessionId: s.id, shareCodeId: s.share_code_id, correct, total, pct });
  }

  const prior = await priorFinish(s.share_code_id, s.student_id, s.id);
  // Counted when no OTHER attempt finished before this one.
  const earlier = prior && s.completed_at && String(prior.completed_at) > String(s.completed_at) ? null : prior;
  const counted = countedFor(earlier, tok.d, Boolean(s.user_id));
  const nameOf = await shownNames(s.student_id ? await codeLanguage(s.share_code_id) : null, [s.student_id]);
  const first = nameOf(s.student_id, s.student_name);
  return {
    score: { correct, total, pct, level },
    ...counted,
    review: served.map((q) => ({
      qid: q.id, picked: byQ.get(q.id).selected_option, correct_slot: WebItems.keyFor(q),
      ok: Boolean(byQ.get(q.id).is_correct), why: q.explanation || null,
    })),
    card: {
      first, animal: T.animalFor(s.student_id || s.id), correct, total, stars: correct,
      // A practice round: the card says so and carries the kept first-try score the league shows.
      ...(earlier && !s.user_id ? { practice: true, kept: { correct: earlier.correct_answers || 0, total: earlier.total_questions_answered || 0 } } : {}),
    },
    challenge_code: await challengeCodeFor(s),
    // A friend's challenge: who won against the score the landing showed them.
    // (Never against themselves: a child who opens their own challenge link is not their own challenger.)
    ...(s.invited_by_student_id && s.invited_by_student_id !== s.student_id ? await versus(s, { correct, total }) : {}),
  };
}

async function versus(s, mine) {
  try {
    const ch = await challengeOf({ shareCodeId: s.share_code_id, invitedByStudentId: s.invited_by_student_id, lang: await codeLanguage(s.share_code_id) });
    return ch ? { vs: { ...ch, outcome: challengeOutcome(mine, ch) } } : {};
  } catch (e) {
    logToFile('⚠️ web-quiz: challenge outcome unavailable', { sessionId: s.id, error: e.message });
    return {};
  }
}

// ─── E6 the class league table ─────────────────────────────────────────────

/** Ranked by score (pct, then correct); ties share a place (1, 1, 3). Pure. */
function rankRows(rows) {
  const sorted = [...rows].sort((a, b) => (b.pct - a.pct) || (b.correct - a.correct) || a.first.localeCompare(b.first));
  let place = 0;
  return sorted.map((r, i) => {
    const prev = sorted[i - 1];
    if (!prev || prev.pct !== r.pct || prev.correct !== r.correct) place = i + 1;
    return { ...r, place };
  });
}

async function board(code, { st } = {}) {
  requireOn();
  const ctx = await resolveCode(code);
  const report = require('./video-quiz-report.service');
  // The teacher report's own loader: self-tests and invited friends out, one
  // attempt per child (first finished for a web-arm quiz).
  const cls = await report.loadClassRows(ctx.shareCodeId);
  const nameOf = await shownNames(ctx.lang, ((cls && cls.rows) || []).map((r) => r.studentId));
  const rows = ((cls && cls.rows) || []).map((r) => ({
    sessionId: r.sessionId, studentId: r.studentId, first: nameOf(r.studentId, r.name),
    animal: T.animalFor(r.studentId || r.sessionId), correct: r.correct, total: r.total, pct: r.pct,
  }));
  const ranked = rankRows(rows);
  const n = ranked.length;
  const out = {
    finishers_n: n,
    class_avg_pct: n ? Math.round(ranked.reduce((a, r) => a + (r.pct || 0), 0) / n) : 0,
    rows: ranked.slice(0, BOARD_TOP).map((r) => ({ place: r.place, first: r.first, animal: r.animal, correct: r.correct, total: r.total })),
    more_n: Math.max(0, n - BOARD_TOP),
  };
  if (st) {
    const tok = T.verify(st, 's');
    if (tok && tok.sc === ctx.shareCodeId) {
      const { data: s } = await supabase.from('quiz_sessions').select('id, student_id').eq('id', tok.sid).maybeSingle();
      const mine = s && ranked.find((r) => (s.student_id ? r.studentId === s.student_id : r.sessionId === s.id));
      if (mine) out.you = { place: mine.place, correct: mine.correct, total: mine.total, pct: mine.pct };
    }
  }
  return out;
}

// ─── E7 me ──────────────────────────────────────────────────────────────────

async function me(body = {}) {
  requireOn();
  const ctx = await resolveCode(body.code);
  const wanted = new Set((Array.isArray(body.chips) ? body.chips : []).slice(0, 10).map(String));
  const chips = (await classChips(ctx)).filter((c) => wanted.has(c.chip));
  const out = { history: [], friends_finished: [] };
  if (!chips.length) return out;
  const chipOf = new Map(chips.map((c) => [c.studentId, c.chip]));
  const ids = chips.map((c) => c.studentId);
  const { data: mine } = await supabase.from('quiz_sessions')
    .select('id, student_id, share_code_id, correct_answers, total_questions_answered, mastery_percentage, completed_at')
    .in('student_id', ids).eq('status', 'completed').order('completed_at', { ascending: false }).limit(30);
  const { data: friends } = await supabase.from('quiz_sessions')
    .select('id, student_name, invited_by_student_id, share_code_id, correct_answers, total_questions_answered, completed_at')
    .in('invited_by_student_id', ids).eq('status', 'completed').order('completed_at', { ascending: false }).limit(20);
  const codeIds = [...new Set([...(mine || []), ...(friends || [])].map((r) => r.share_code_id).filter(Boolean))];
  const topics = new Map();
  if (codeIds.length) {
    const { data: codes } = await supabase.from('quiz_share_codes').select('id, topic').in('id', codeIds);
    (codes || []).forEach((c) => topics.set(c.id, c.topic || ''));
  }
  out.history = (mine || []).map((r) => ({
    chip: chipOf.get(r.student_id), topic: topics.get(r.share_code_id) || '',
    date: String(r.completed_at || '').slice(0, 10), correct: r.correct_answers || 0,
    total: r.total_questions_answered || 0, pct: r.mastery_percentage || 0,
  }));
  // The challenger's score a friend was shown: their FIRST finish on that class code.
  const firstOf = (studentId, codeId) => (mine || []).filter((m) => m.student_id === studentId && m.share_code_id === codeId)
    .sort((a, b) => String(a.completed_at).localeCompare(String(b.completed_at)))[0];
  out.friends_finished = (friends || []).map((r) => {
    const theirs = firstOf(r.invited_by_student_id, r.share_code_id);
    const friend = { correct: r.correct_answers || 0, total: r.total_questions_answered || 0 };
    return {
      chip: chipOf.get(r.invited_by_student_id), first: firstName(r.student_name), topic: topics.get(r.share_code_id) || '',
      ...friend,
      ...(theirs ? { outcome: challengeOutcome(friend, { correct: theirs.correct_answers || 0, total: theirs.total_questions_answered || 0 }) } : {}),
    };
  });
  return out;
}

// ─── E8 events ──────────────────────────────────────────────────────────────

const EVENT_NAME_RX = /^[a-z][a-z0-9_]{0,39}$/;
const EVENT_PROPS = Object.freeze({
  code: /^[A-Z0-9]{4,12}$/i, qid: /^[0-9a-f-]{8,64}$/i, slot: /^[A-D]$/i, step: /^[a-z0-9_]{1,32}$/,
  src: /^[a-z0-9_]{1,32}$/, reason: /^[a-z0-9_]{1,40}$/, lang: /^(en|ur)$/, net: /^[a-z0-9_]{1,16}$/, err: /^[a-z0-9_]{1,40}$/,
  part: /^[a-z]{1,4}$/, // which spoken part had no clip (audio_missing): q, opt, stim, fig, left, why, fb, hint
});
const EVENT_NUMS = ['ms', 'seq', 'n', 'i', 'pct', 't'];
const EVENT_BOOLS = ['ok'];
const SHARE_PATHS = ['native', 'wa', 'copy'];
const UA_MAX = 300;
const PROBE_MAX = 4096;

/** Keep only allow-listed props of the right shape: no names, no free text, no phone. Pure. */
function cleanEvent(e) {
  if (!e || typeof e !== 'object' || !EVENT_NAME_RX.test(String(e.n || ''))) return null;
  const props = {};
  for (const [k, rx] of Object.entries(EVENT_PROPS)) {
    if (typeof e[k] === 'string' && rx.test(e[k])) props[k] = e[k];
  }
  for (const k of EVENT_NUMS) {
    const v = Number(e[k]);
    if (e[k] !== undefined && Number.isFinite(v)) props[k === 'n' ? 'count' : k] = v;
  }
  for (const k of EVENT_BOOLS) if (typeof e[k] === 'boolean') props[k] = e[k];
  if (typeof e.ua === 'string' && e.ua) props.ua = e.ua.slice(0, UA_MAX);
  if (e.store === 0 || e.store === 1) props.store = e.store;
  // In-app browser (WhatsApp's own browser): the page sends 1/0; kept as 0/1 so the logs can split on it.
  if (e.iab === 0 || e.iab === 1) props.iab = e.iab;
  else if (typeof e.iab === 'boolean') props.iab = e.iab ? 1 : 0;
  if (SHARE_PATHS.includes(e.path)) props.path = e.path;
  if (e.n === 'probe') {
    const probe = cleanProbe(e.probe);
    if (probe) props.probe = probe;
  }
  return { name: e.n, props };
}

/**
 * The capability probe's results (storage, share, in-app-browser markers):
 * one flat level of short strings, numbers and booleans, under 4 KB. Nested
 * objects are dropped; an oversized probe is dropped whole.
 */
function cleanProbe(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const out = {};
  for (const [k, v] of Object.entries(p).slice(0, 80)) {
    if (!/^[A-Za-z0-9_.-]{1,40}$/.test(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 200);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
  }
  return JSON.stringify(out).length <= PROBE_MAX ? out : null;
}

function events(body = {}) {
  const list = Array.isArray(body.events) ? body.events.slice(0, 20) : [];
  let logged = 0;
  for (const e of list) {
    const c = cleanEvent(e);
    if (!c) continue;
    logEvent(`web_quiz.${c.name}`, c.props);
    logged += 1;
  }
  return { logged };
}

// ─── E10 media ──────────────────────────────────────────────────────────────

/**
 * Where a question's picture lives: a redirect to a presigned R2 URL, or —
 * for the option pictures the generator stored inline as base64 — the bytes.
 */
async function media(code, qid, { k, z } = {}) {
  requireOn();
  const ctx = await resolveCode(code);
  if (qid === 'video') {
    const helpers = mediaHelpers();
    const v = helpers ? await helpers.presignVideo({ video_id: ctx.parent.video_id }, { db: supabase, expiresIn: MEDIA_TTL_S }).catch(() => null) : null;
    if (!v || !v.url) fail(404, 'not_found');
    return { redirect: v.url };
  }
  if (!/^[0-9a-f-]{8,64}$/i.test(String(qid || ''))) fail(404, 'not_found');
  const { data: q } = await supabase.from('quiz_questions').select('id, media').eq('id', qid).eq('quiz_id', ctx.quizId).maybeSingle();
  if (!q) fail(404, 'not_found');
  const key = String(k || 'q').toUpperCase();
  const item = key === 'Q' ? questionImageOf(q.media) : SLOTS.includes(key) ? optionImageOf(q.media, SLOTS.indexOf(key)) : null;
  if (!item) fail(404, 'not_found');
  // ?z=1: the option cropped to where the set's pictures differ (questionPayload adds it).
  if (String(z || '') === '1' && key !== 'Q' && item.b64) {
    const box = await PictureZoom.zoomFor(q).catch(() => null);
    const png = box ? await PictureZoom.crop(item.b64, box) : null;
    if (png) return { bytes: png, contentType: 'image/png' };
  }
  const url = typeof item === 'string' ? item : item.url || item.r2_url || null;
  if (url) {
    const r2 = require('../../storage/r2');
    const signed = await r2.getPresignedUrl(url, MEDIA_TTL_S).catch(() => url);
    return { redirect: signed || url };
  }
  if (item.b64) {
    const buf = Buffer.from(String(item.b64), 'base64');
    const png = buf.length > 3 && buf[0] === 0x89 && buf[1] === 0x50;
    return { bytes: buf, contentType: png ? 'image/png' : 'image/jpeg' };
  }
  fail(404, 'not_found');
}

module.exports = {
  getQuiz, startSession, recordAnswers, finishSession, board, me, events, media,
  // exported for tests and the router
  WqError, rankRows, cleanEvent, pktMidnightIso, resolveCode, classChips, whoPlayed, fixWho, whoClass, challengeOutcome,
  BOARD_TOP, QUESTIONS_MAX,
};
