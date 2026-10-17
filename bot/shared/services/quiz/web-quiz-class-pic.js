'use strict';
/**
 * THE CLASS LINK'S PICTURE: what a teacher's forwarded /q/<CODE> previews as in WhatsApp (its og:image).
 *
 *   class quiz   the class label + the quiz topic                 app_settings quiz_teacher_home
 *   class story  the class label + the book's title + its cover   quiz_teacher_home AND the story send's switch
 *                                                                 (story-teacher.service flagOn: web_quiz_stories_teacher,
 *                                                                 web_quiz_stories, web_quiz_hub)
 *
 *   field(ctx, {story})   {teach, teach_v} for the page's `art` (the signed id and the picture's version), else null:
 *                         a switch off, a child's code (a challenge or "watch another video" code), no label of
 *                         the sender's own class for a quiz, a word the picture never says. Never throws.
 *   image(id, {code})     {bytes, contentType: 'image/png', immutable: true}: 1200x630, ≤ 40 KB, drawn in the share
 *                         pictures' one headless queue (web-quiz-art.js drawTurn), kept in memory by id + version.
 *                         ArtError(404) for an id not issued, a switch off, or a code that is not this picture's own.
 *
 * The id is web-quiz-art-id.js's kind 't', ref = the class share code's id: its own letter, so no child-keyed id
 * (a session, a challenge code) can stand in for it, and it is drawn only when asked under its own /q/<CODE>.
 * The picture names the class (from `classes`, through resolveQuizClass, and only a class the sender teaches), the
 * topic or the book (story_books, never the quiz row's topic), and the brand. Never a child, a count, a score, the
 * teacher's name or a phone. On an Urdu picture every digit is drawn as an Urdu digit.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { clampLanguage } = require('../../config/ux-strings');
const { artId, parseArtId, UUID_RX } = require('./web-quiz-art-id');
const { pageTopic } = require('./quiz-child-title');
const { bookOf } = require('./story-teacher-report');
const StoryStore = require('./story-store');

const LANG = (v) => clampLanguage(v, ['en', 'ur']);
const KIND = 't';
// bump when the picture's look or words change: every picture gets a new version (and so a new link)
const PIC_V = 1;
const W = 1200;
const H = 630;
const MAX_BYTES = 40 * 1024;
const MEM_MAX = 64;
const FACTS_MS = 60 * 1000;
const CODE_RX = /^[A-Z0-9]{4,12}$/;
// Words a class link's picture never says, in either language (a topic carrying one gets today's picture).
const TEST_WORDS = /\btest\b|\bexam|assessment|امتحان|ٹیسٹ/i;
// The cover is drawn in a box of this size (CSS px); it is shrunk to it before it is embedded.
const COVER_W = 330;
const COVER_H = 440;

// The fixed words (the class label, the topic and the title come from data).
const COPY = {
  en: { cls: 'Class', quiz: 'Quiz', story: 'Story' },
  ur: { cls: 'جماعت', quiz: 'کوئز', story: 'کہانی' },
};

/** ASCII digits as Urdu (Extended Arabic-Indic) digits. A local helper: the page's wq-digits.js is not on this base. */
function urDigits(s) {
  return String(s == null ? '' : s).replace(/[0-9]/g, (d) => String.fromCharCode(0x06F0 + Number(d)));
}
/** Urdu (U+06F0-9) and Arabic-Indic (U+0660-9) digits as ASCII: a stored «۳-A» reads «3-A» on the English picture. */
function asciiDigits(s) {
  return String(s == null ? '' : s).replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) => String((d.charCodeAt(0) & 0xF)));
}

// ─── the facts ──────────────────────────────────────────────────────────────

const memo = new Map();

/** The sender's own class label for a code, or null: the class resolution, then the class must be one they teach. */
async function ownLabel(sc) {
  const { resolveQuizClass } = require('./web-quiz-identity');
  const r = await resolveQuizClass({ teacherUserId: sc.teacher_user_id, quizId: sc.quiz_id, shareCodeId: sc.id });
  if (!r || r.state !== 'known' || !r.class) return null;
  const c = r.class;
  if (c.id) {
    const { data } = await supabase.from('class_teachers').select('class_id')
      .eq('class_id', c.id).eq('teacher_user_id', sc.teacher_user_id).eq('is_active', true).limit(1);
    if (!data || !data.length) return null;
  } else if (!c.legacy) {
    return null;
  }
  const label = String(c.label || '').trim().slice(0, 24);
  return label || null;
}

async function factsNow(shareCodeId) {
  const { data: sc } = await supabase.from('quiz_share_codes')
    .select('id, code, quiz_id, teacher_user_id, topic, language, active, expires_at, invited_by_student_id, parent_share_code_id')
    .eq('id', shareCodeId).maybeSingle();
  // a teacher's own class code only: never a child's challenge code, never a "watch another video" code
  if (!sc || sc.invited_by_student_id || sc.parent_share_code_id || !sc.teacher_user_id || !sc.quiz_id) return null;
  if (!sc.active || (sc.expires_at && new Date(sc.expires_at) < new Date())) return null;
  const { data: q } = await supabase.from('quizzes').select('id, topic, meta, quiz_source').eq('id', sc.quiz_id).maybeSingle();
  if (!q) return null;
  const lang = LANG(sc.language);
  const code = String(sc.code || '').toUpperCase();
  const bookId = q.quiz_source === 'story' ? bookOf(q) : null;
  let f;
  if (bookId) {
    if (!(await require('./story-teacher.service').flagOn())) return null;
    const { data: book } = await supabase.from('story_books').select('id, title, cover_file').eq('id', bookId).maybeSingle();
    const title = book && String(book.title || '').trim();
    if (!title) return null;
    const cover = book.cover_file && StoryStore.FILE_RX.test(book.cover_file) && StoryStore.BOOK_RX.test(String(book.id)) ? book.cover_file : null;
    f = { kind: 'story', lang, code, label: await ownLabel(sc), title, bookId: String(book.id), cover };
  } else {
    const topic = String(pageTopic({ lang, meta: q.meta, fallback: sc.topic || q.topic }) || '').trim();
    const label = await ownLabel(sc);
    // a class quiz's picture is the class and its topic: without the sender's own class it is today's picture
    if (!topic || !label) return null;
    f = { kind: 'quiz', lang, code, label, topic };
  }
  if ([f.label, f.topic, f.title].some((t) => t && TEST_WORDS.test(t))) return null;
  f.v = crypto.createHash('sha256').update(JSON.stringify([PIC_V, f.kind, f.lang, f.label, f.topic || null, f.title || null, f.cover || null])).digest('hex').slice(0, 8);
  return f;
}

/** The picture's facts for a class code's id, or null. Both switches are read first; off, nothing else is. */
async function factsFor(shareCodeId) {
  if (!UUID_RX.test(String(shareCodeId || ''))) return null;
  if (!(await require('../first-touch/teacher-home.flags').on())) return null;
  const kept = memo.get(shareCodeId);
  if (kept && kept.until > Date.now()) {
    if (kept.f && kept.f.kind === 'story' && !(await require('./story-teacher.service').flagOn())) return null;
    return kept.f;
  }
  const f = await factsNow(shareCodeId);
  memo.set(shareCodeId, { f, until: Date.now() + FACTS_MS });
  if (memo.size > MEM_MAX * 8) memo.delete(memo.keys().next().value);
  return f;
}

/** The page's `art` fields for this code ({teach, teach_v}), else null. Never throws. */
async function field(ctx, { story = null } = {}) {
  try {
    if (!ctx || ctx.invitedByStudentId || ctx.moreVideosOf) return null;
    if (ctx.row && (ctx.row.invited_by_student_id || ctx.row.parent_share_code_id)) return null;
    const f = await factsFor(ctx.shareCodeId);
    if (!f || f.code !== String(ctx.code || '').toUpperCase()) return null;
    // a story's picture only where the page opens the story
    if (f.kind === 'story' && !story) return null;
    const id = artId(KIND, ctx.shareCodeId);
    return id ? { teach: id, teach_v: f.v } : null;
  } catch (e) {
    logToFile('⚠️ class link picture: facts failed — today\'s picture', { error: e && e.message });
    return null;
  }
}

// ─── the picture ────────────────────────────────────────────────────────────

let _assets = null;
function b64(rel) {
  try {
    const abs = path.join(__dirname, '..', '..', rel);
    return fs.existsSync(abs) ? fs.readFileSync(abs).toString('base64') : '';
  } catch (_) { return ''; }
}
// The finish card's faces (web-quiz-card-image.js): Lexend Bold, and the Nastaliq Regular file drawn bold (the Bold file
// breaks a join), with '!' from Lexend.
function assets() {
  if (!_assets) {
    _assets = {
      lexendBold: b64('fonts/Lexend-Bold.ttf'),
      nastaliq: b64('fonts/NotoNastaliqUrdu-Regular.ttf'),
      hello: b64('assets/wq-art/hello.webp'),
    };
  }
  return _assets;
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const URDU_RX = /[؀-ۿ]/;

/**
 * The picture's HTML (pure): what the headless browser photographs.
 * f: {kind: 'quiz'|'story', lang, label?, topic?, title?}; opt.cover: {type, b64} of the book's cover; opt.fonts false
 * only for a layout check.
 */
function renderClassPic(f, opt = {}) {
  const lang = LANG(f.lang);
  const rtl = lang === 'ur';
  const t = COPY[lang];
  const a = opt.fonts === false ? {} : assets();
  const shown = (s) => (rtl ? urDigits(s) : String(s || ''));
  const fonts = opt.fonts === false ? '' : `@font-face{font-family:'Lexend';font-weight:800;src:url(data:font/ttf;base64,${a.lexendBold})}
@font-face{font-family:'NastaliqUrdu';font-weight:400;src:url(data:font/ttf;base64,${a.nastaliq})}
@font-face{font-family:'NastaliqUrdu';font-weight:400;src:url(data:font/ttf;base64,${a.lexendBold});unicode-range:U+0021}`;
  const face = rtl ? "'NastaliqUrdu','Lexend',sans-serif" : "'Lexend','NastaliqUrdu',sans-serif";
  const story = f.kind === 'story';
  const name = story ? f.title : f.topic;
  // a title keeps the script it is written in: an English title on an Urdu picture is its own LTR run
  const nameDir = URDU_RX.test(name || '') ? 'rtl' : 'ltr';
  const cover = opt.cover && opt.cover.b64 ? `<img class="cover" src="data:${opt.cover.type};base64,${opt.cover.b64}" alt="">` : null;
  const art = cover || (a.hello ? `<img class="jug" src="data:image/webp;base64,${a.hello}" alt="">` : '<div class="jug"></div>');
  // the class label: Urdu digits on the Urdu picture, ASCII digits on the English one (whichever the label was stored in)
  const label = f.label ? `<div class="pill">${esc(t.cls)} <bdi dir="ltr">${esc(rtl ? urDigits(f.label) : asciiDigits(f.label))}</bdi></div>` : '';
  const long = String(name || '').length > (rtl ? 26 : 30);
  return `<!doctype html><html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>${fonts}
*{box-sizing:border-box;margin:0;padding:0}
body{width:${W}px;height:${H}px;overflow:hidden;background:#FFF8E7}
.pic{position:relative;width:${W}px;height:${H}px;display:flex;align-items:center;gap:56px;padding:48px 72px 66px;background:#FFF8E7;color:#1F2937;font-family:${face};border-bottom:18px solid #15803D}
.cover{width:${COVER_W}px;height:${COVER_H}px;flex:0 0 ${COVER_W}px;object-fit:cover;border-radius:20px;border:6px solid #fff;box-shadow:0 6px 0 #E5D9BC}
.jug{width:320px;height:320px;flex:0 0 320px;object-fit:contain}
.txt{flex:1;display:flex;flex-direction:column;align-items:flex-start;gap:${rtl ? 10 : 22}px;min-width:0}
.pill{display:inline-block;padding:${rtl ? '2px 28px 10px' : '10px 28px'};border-radius:999px;background:#15803D;color:#fff;font-weight:${rtl ? 700 : 800};font-size:${rtl ? 40 : 40}px;line-height:${rtl ? 1.9 : 1.2}}
.pill bdi{font-family:'Lexend','NastaliqUrdu',sans-serif;font-weight:800}
.kind{font-weight:${rtl ? 700 : 800};font-size:${rtl ? 40 : 34}px;line-height:${rtl ? 1.9 : 1.2};color:#92400E}
.name{font-weight:${rtl ? 700 : 800};font-size:${long ? (rtl ? 52 : 56) : (rtl ? 62 : 70)}px;line-height:${rtl ? 1.75 : 1.12};color:#14532D;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${rtl ? 2 : 3};overflow:hidden;word-break:keep-all;overflow-wrap:normal;text-wrap:balance;unicode-bidi:isolate;max-width:100%;padding:${rtl ? '10px 24px 34px' : '0 4px'};margin:${rtl ? '0 -24px -24px' : '0 -4px'}}
.brand{position:absolute;${rtl ? 'left' : 'right'}:72px;bottom:30px;font:800 28px/1 'Lexend',sans-serif;color:#15803D;letter-spacing:.04em}
</style></head><body><div class="pic">${art}<div class="txt">
${label}
<div class="kind">${esc(story ? t.story : t.quiz)}</div>
<div class="name" dir="${nameDir}">${esc(shown(name))}</div>
</div><div class="brand">JUGNU</div></div></body></html>`;
}

/** The book's cover, shrunk to its box, as {type, b64}; null when storage cannot give it (the picture draws without). */
async function coverOf(f) {
  if (f.kind !== 'story' || !f.cover) return null;
  try {
    const r2 = require('../../storage/r2');
    const key = StoryStore.storyKey({ bookId: f.bookId, file: f.cover });
    const raw = await r2.downloadFromR2(key, { bucket: StoryStore.storyBucket() || undefined });
    if (!raw || !raw.length) return null;
    const sharp = require('sharp');
    const small = await sharp(raw).resize(COVER_W, COVER_H, { fit: 'cover' }).jpeg({ quality: 70 }).toBuffer();
    return { type: 'image/jpeg', b64: small.toString('base64') };
  } catch (e) {
    logToFile('⚠️ class link picture: cover not read — drawn without it', { error: (e && e.name) || 'error' });
    return null;
  }
}

// Fewer colours until the picture fits (as the finish card does).
async function toPng(png, f) {
  const sharp = require('sharp');
  let out = null;
  for (const colors of [64, 32, 16]) {
    out = await sharp(png).resize(W, H, { fit: 'cover' }).png({ palette: true, colors, compressionLevel: 9, effort: 8 }).toBuffer();
    if (out.length <= MAX_BYTES) return out;
  }
  logToFile('⚠️ class link picture: over 40 KB at 16 colours', { kind: f.kind, lang: f.lang, bytes: out.length });
  return out;
}

async function drawNow(f) {
  const { htmlToImage } = require('../../utils/html-to-pdf');
  const cover = await coverOf(f);
  const png = await htmlToImage(renderClassPic(f, { cover }), { width: W, height: H, deviceScaleFactor: 1, selector: '.pic' });
  return toPng(png, f);
}

const mem = new Map();
const inflight = new Map();

/**
 * The picture for a signed id asked under its own code: {bytes, contentType, immutable}; ArtError(404) else.
 * Reached through web-quiz-art.js artImage, which hands in its headless queue and its error (so this module never
 * requires it back).
 */
async function image(id, { code = null, drawTurn, ArtError } = {}) {
  const notFound = () => { throw new ArtError(404, 'not_found'); };
  const p = parseArtId(id);
  if (!p || p.kind !== KIND) notFound();
  const c = String(code || '').toUpperCase();
  if (!CODE_RX.test(c)) notFound();
  const f = await factsFor(p.ref);
  if (!f || f.code !== c) notFound();
  const key = `${p.ref}|${f.v}`;
  if (mem.has(key)) return { bytes: mem.get(key), contentType: 'image/png', immutable: true };
  if (!inflight.has(key)) {
    const run = drawTurn(() => drawNow(f))
      .then((bytes) => {
        mem.set(key, bytes);
        if (mem.size > MEM_MAX) mem.delete(mem.keys().next().value);
        return bytes;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, run);
  }
  return { bytes: await inflight.get(key), contentType: 'image/png', immutable: true };
}

function _reset() { memo.clear(); mem.clear(); inflight.clear(); }

module.exports = { KIND, PIC_V, COPY, MAX_BYTES, TEST_WORDS, field, image, factsFor, renderClassPic, urDigits, _reset };
