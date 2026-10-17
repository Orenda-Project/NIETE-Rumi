'use strict';
/**
 * Loading storybooks into the database and storage (scripts/web-quiz/load-stories.js is the command around it).
 *
 * planBook() reads ONE book from the files the book preparation produces — the pages manifest entry (pictures, printed
 * words and their boxes, the word band), the page voices (READALONG timing JSON + the clip + its QA numbers), the
 * reviewed questions, the watermark clearance — and decides, without writing anything:
 *   - the rows: story_books, story_pages, story_page_voices, story_questions (ids are uuid v5, so a re-run updates the
 *     same rows and nothing is ever duplicated);
 *   - the files to store, each under its content hash (story-store.js), so a re-render or a re-voice is a new name;
 *   - whether the book is READY: every gate below passes, else it stays a draft (children never see a draft) and the
 *     plan says why, one reason per failed gate.
 * applyPlan() stores the files and writes the rows through a small store interface (supabaseStore() for the real
 * database), in an order that never leaves a ready book pointing at a missing file: files first, then pages, voices,
 * questions, and the book's status last. A book set 'off' by hand stays off.
 *
 * READY gates:
 *   0. watermark: the book's sweep is done (cleared) and every page the cleaning changed was looked at and passed;
 *      story_pages.watermark is false only for such pages
 *   1. pages: the book's text is settled; every picture ≤ 80 KB; every text page has words, a word band and a
 *      current voice whose words are the page's words (same i), wer ≤ 0.10 (en) / 0.15 (ur), its own checks passed,
 *      a local clip, and two pace numbers: words over the whole clip ≤ 100 wpm (grades 1–2) / 115 (3–5; and any page
 *      under 10 words) and over the spoken span ≤ 130 / 145, each with a 2 % measurement tolerance. A wer miss passes
 *      only when the voice build waived it for a listen (listen_asked, and 'wer …' in waived). A page whose voice fails any of these is stored with no voice. The voice's drift
 *      numbers are stored, not gated: the drift gate is the reader's highlight against the audio, measured on the page
 *      (a voice its build marks quality 'low' keeps its voice with that mark: the reader then follows it line by line)
 *      With app_settings web_quiz_story_voice_gate ON (JSON true), the two pace numbers give way to a METHOD gate read
 *      from the voice build's record (qa.json): one take (splices 0), atempo 1, no inserted silence, provider speed ≥ 0.9,
 *      ≥ 48 kb/s, no mid-word silence (midword_hits 0), and a 60–220 wpm whole-clip band so a broken take cannot pass;
 *      words the timing sources could not settle (timing_unresolved or unresolved_words > 0) make the page line-timed. Under the gate a new
 *      take that fails is never stored and never silences a page: the page keeps the voice it has (applyPlan), and only a
 *      page with no voice at all keeps the book a draft.
 *   2. questions: 3–5 reviewed
 *   +  a cover ≤ 15 KB
 * Gate 3 (a lead opens the book on sandbox) is a person's: the lead sets status 'off' on a book that fails it.
 */
const fs = require('fs');
const path = require('path');
const Store = require('./story-store');

const MAX_PAGE_BYTES = 80 * 1024;
const MAX_COVER_BYTES = 15 * 1024;
const MAX_WER = { en: 0.10, ur: 0.15 };
const MAX_DRIFT_MS = 120;
// The pace gates keep a 2 % measurement tolerance and no more; a page under 10 words has the whole-clip gate of grades 3–5
// (one or two words decide its pace) and its span gate decides.
const SHORT_PAGE_WORDS = 10;
const tolerant = (gate) => Math.round(gate * 102) / 100;
const maxWpm = (grade, nWords) => tolerant(grade <= 2 && nWords >= SHORT_PAGE_WORDS ? 100 : 115);
const maxSpanWpm = (grade) => tolerant(grade <= 2 ? 130 : 145);
// The voice method gate (a natural-speed take, as delivered): the record's numbers and the whole-clip band.
const VOICE_GATE_KEY = 'web_quiz_story_voice_gate';
const MIN_SPEED = 0.9;
const MIN_KBPS = 48;
const WPM_BAND = [60, 220];
const voiceGateOn = (value) => value === true;
const TYPES = { webp: 'image/webp', ogg: 'audio/ogg', mp3: 'audio/mpeg', png: 'image/png' };
const pad = (n) => String(n).padStart(2, '0');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}
function readBytes(p) {
  try { return fs.readFileSync(p); } catch (_) { return null; }
}

/** A WebP's width and height from its header (VP8, VP8L or VP8X), or null. */
function webpSize(buf) {
  if (!buf || buf.length < 30 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const kind = buf.toString('ascii', 12, 16);
  if (kind === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
  if (kind === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) }; }
  return null;
}

/** A stored file the plan needs: its local bytes, the name it will have, its type. */
function fileOf(buf, stem, ext) {
  return { buf, name: Store.hashedName(`${stem}.${ext}`, buf), contentType: TYPES[ext] || 'application/octet-stream' };
}

/** The page's words as the contract keeps them: {i, t, box?} only. */
function cleanWords(words) {
  return (Array.isArray(words) ? words : []).map((w) => (Array.isArray(w.box) && w.box.length === 4
    ? { i: w.i, t: w.t, box: w.box.map((x) => Math.round(x)) } : { i: w.i, t: w.t }));
}

/** Each printed line as {i0, i1, box} (integers), or null when the page has none. */
function cleanLines(lines) {
  if (!Array.isArray(lines) || !lines.length) return null;
  const ok = lines.filter((l) => l && Number.isInteger(l.i0) && Number.isInteger(l.i1) && l.i1 >= l.i0);
  return ok.length ? ok.map((l) => (Array.isArray(l.box) && l.box.length === 4 ? { i0: l.i0, i1: l.i1, box: l.box.map((x) => Math.round(x)) } : { i0: l.i0, i1: l.i1 })) : null;
}

/** The voice for page n: READALONG JSON (+ qa.json beside it, + the clip) → {row fields, file, why[]}. */
const voiceId = (r) => [r.provider, r.voice, r.model].join('|');

/** Why a question clip's build record (questions.voice.json clips[key]) is not one natural take; [] = it is. */
function clipMethodWhy(key, rec) {
  if (!rec || typeof rec !== 'object') return [`${key}: no build record`];
  const why = [];
  const m = (k, ok, say) => { const x = num(rec[k]); if (x == null || !ok(x)) why.push(`${key}: ${say(x == null ? 'unknown' : x)}`); };
  m('splices', (x) => x === 0, (x) => `splices ${x}`);
  m('atempo', (x) => x === 1, (x) => `atempo ${x}`);
  m('inserted_silence_ms', (x) => x === 0, (x) => `inserted silence ${x}${x === 'unknown' ? '' : ' ms'}`);
  m('speed', (x) => x >= MIN_SPEED, (x) => `speed ${x}`);
  m('kbps', (x) => x >= MIN_KBPS, (x) => (x === 'unknown' ? 'kb/s unknown' : `${x} kb/s`));
  return why;
}

function voiceFor({ voiceDir, n, words, lang, grade = 1, voiceGate = false }) {
  const stem = path.join(voiceDir, `p${pad(n)}`);
  const j = readJson(`${stem}.json`);
  if (!j) return { why: ['no voice'] };
  const qa = readJson(`${stem}.qa.json`) || {};
  const why = [];
  const ts = Array.isArray(j.words) ? j.words : [];
  const want = words.map((w) => w.i).join(',');
  if (ts.map((w) => w.i).join(',') !== want) why.push('voice words differ from the page words');
  const bad = ts.some((w) => !(Number.isFinite(w.s_ms) && Number.isFinite(w.e_ms) && w.e_ms >= w.s_ms));
  if (bad) why.push('voice timings malformed');
  const pick = (k) => num(qa[k]) != null ? qa[k] : num(j[k]);
  const wer = pick('wer');
  const drift = pick('drift_ms_max');
  // A wer miss ships only when the voice build waived it for a person's listen (a short word every recogniser mishears).
  const listenWaived = qa.listen_asked === true && Array.isArray(qa.waived) && qa.waived.some((w) => /^wer\b/.test(String(w)));
  if (wer == null || (wer > MAX_WER[lang] && !listenWaived)) why.push(`voice wer ${wer == null ? 'unknown' : wer}`);
  const clipWpm = num(j.wpm) != null ? j.wpm : (num(qa.wpm_clip) != null ? qa.wpm_clip : num(qa.wpm));
  if (voiceGate) {
    // How the take was made, not how fast it reads: one provider call, its bytes as delivered.
    const m = (k, ok, say) => { const x = num(qa[k]); if (x == null || !ok(x)) why.push(`voice method: ${say(x == null ? 'unknown' : x)}`); };
    m('splices', (x) => x === 0, (x) => `splices ${x}`);
    m('atempo', (x) => x === 1, (x) => `atempo ${x}`);
    m('inserted_silence_ms', (x) => x === 0, (x) => (x === 'unknown' ? 'inserted silence unknown' : `inserted silence ${x} ms`));
    m('speed', (x) => x >= MIN_SPEED, (x) => `speed ${x}`);
    m('kbps', (x) => x >= MIN_KBPS, (x) => (x === 'unknown' ? 'kb/s unknown' : `${x} kb/s`));
    // the word times come from the provider or a forced alignment of the stored audio, never a recogniser's alignment
    const tsrc = j.timing_source || j.timing_src || qa.timing_source || qa.timing_src || null;
    if (!['provider', 'forced_align'].includes(tsrc)) why.push(`voice timing source ${tsrc || 'unknown'}`);
    const mid = num(qa.midword_hits);
    if (mid !== 0) why.push(`voice midword silence ${mid == null ? 'unknown' : mid}`);
    if (clipWpm == null || clipWpm < WPM_BAND[0] || clipWpm > WPM_BAND[1]) why.push(`voice pace ${clipWpm == null ? 'unknown' : clipWpm} wpm outside ${WPM_BAND[0]}–${WPM_BAND[1]}`);
  } else {
    // Two pace gates: words over the whole clip (what the child sits through), and over the spoken span (what the eye follows).
    if (clipWpm == null || clipWpm > maxWpm(grade, words.length)) why.push(`voice pace ${clipWpm == null ? 'unknown' : clipWpm} wpm`);
    const spanWpm = num(j.pace_wpm) != null ? j.pace_wpm : num(qa.pace_wpm);
    if (spanWpm == null || spanWpm > maxSpanWpm(grade)) why.push(`voice span pace ${spanWpm == null ? 'unknown' : spanWpm} wpm`);
  }
  if (j.ok === false || qa.ok === false) why.push(`voice failed its own checks${Array.isArray(j.fails) && j.fails.length ? ` (${j.fails.slice(0, 2).join(', ')})` : ''}`);
  const clip = readBytes(`${stem}.ogg`);
  const remoteKey = j.audio && typeof j.audio.key === 'string' ? j.audio.key : null;
  // Only the local clip is served (copied under /s/); a stored key alone names the timing file, never the audio.
  if (!clip) why.push('voice clip missing');
  const ms = num(j.audio && j.audio.ms) || num(j.ms);
  if (!ms) why.push('voice length unknown');
  const v = j.voice || {};
  const src = j.timing_source || j.timing_src || qa.timing_source || 'stt_align';
  return {
    why,
    file: clip ? fileOf(clip, `a${pad(n)}`, 'ogg') : null,
    row: {
      lang, provider: v.provider || qa.provider || 'soniox', voice: v.voice || v.id || qa.voice || 'unknown', model: v.model || null,
      timing_key: remoteKey && /\.(ogg|mp3)$/.test(remoteKey) ? remoteKey.replace(/\.(ogg|mp3)$/, '.json') : null, ms: ms || 0, timings: ts.map((w) => ({ i: w.i, s_ms: Math.round(w.s_ms), e_ms: Math.round(w.e_ms) })),
      timing_source: ['provider', 'stt_align', 'provider+stt', 'forced_align'].includes(src) ? src : 'stt_align',
      wpm: num(j.pace_wpm) != null ? j.pace_wpm : pick('wpm'), drift_ms_mean: pick('drift_ms_mean'), drift_ms_max: drift, wer,
      // Line-timed unless the voice's own timing checks have run and passed: its 'low' mark (or the mirror field),
      // or no p90 drift yet (a page re-made since the last check) all count as 'low'.
      cost_usd: pick('cost_usd'), quality: (j.quality === 'low' || j.timing_quality === 'low' || qa.timing_quality === 'low' || pick('drift_ms_p90') == null
        || (voiceGate && (num(qa.timing_unresolved) > 0 || num(qa.unresolved_words) > 0))) ? 'low' : null,
    },
  };
}

/**
 * One book's plan. book = the pages manifest entry; serveDir = its files' folder; voiceDir = the book's voice
 * folder (<source_id>/); questionsFile = its questions file (<source_id>.json); cleared = whether the book's
 * watermark sweep is done; extra = {pdf_r2_key, slo} from the catalogue; voiceGate = the method gate is on (then a page's
 * failed voice goes to plan.misses, not plan.why: applyPlan decides whether the page keeps the voice it has).
 */
function planBook({ book, serveDir, voiceDir = null, questionsFile = null, cleared = false, cleanPages = null, cleanDir = null, extra = {}, convert = null, voiceGate = false }) {
  const why = [];
  const bookId = Store.bookIdFor(book.source_id);
  const lang = book.lang;
  if (!Object.prototype.hasOwnProperty.call(MAX_WER, lang)) why.push(`language ${lang}`);
  const files = [];
  if (!book.text_ready || (Array.isArray(book.unsettled_pages) && book.unsettled_pages.length)) why.push('text not settled');
  if (!cleared) why.push('watermark: not cleared');

  let cover = null;
  let coverSize = null;
  const coverName = book.cover && (book.cover.thumb || book.cover.file);
  const coverBuf = coverName ? readBytes(path.join(serveDir, coverName)) : null;
  if (!coverBuf) why.push('cover missing');
  else {
    cover = fileOf(coverBuf, 'cover', 'webp');
    coverSize = webpSize(coverBuf);
    files.push(cover);
    if (coverBuf.length > MAX_COVER_BYTES) why.push(`cover ${coverBuf.length} B > 15 KB`);
  }

  const pages = [];
  const voices = [];
  const misses = [];
  for (let p of (Array.isArray(book.pages) ? book.pages : []).filter((x) => x && x.n >= 1).sort((a, b) => a.n - b.n)) {
    const tag = `p${pad(p.n)}`;
    const pid = Store.uuidV5(bookId, tag);
    // The watermark-cleaning step's version of this page wins: its picture and band, and its looker's verdict.
    const c = cleanPages && cleanPages.get(p.n);
    if (c && c.image && c.image.file && cleanDir) p = { ...p, image: { ...p.image, ...c.image, file: null, cleanFile: c.image.file } };
    if (c && c.text_band && c.text_band.file && cleanDir) p = { ...p, text_band: { ...c.text_band, cleanFile: c.text_band.file } };
    const pageClear = cleared && !(c && c.cleaned && !(c.looked && c.ok !== false));
    if (cleared && !pageClear) why.push(`${tag}: cleaned page not passed by a looker`);
    let img = p.image && p.image.cleanFile ? readBytes(path.join(cleanDir, p.image.cleanFile))
      : (p.image && p.image.file ? readBytes(path.join(serveDir, p.image.file)) : null);
    if (!img && convert && p.image && p.image.master) img = convert(path.join(serveDir, p.image.master));
    if (!img) { why.push(`${tag}: picture missing`); continue; }
    const imgF = fileOf(img, tag, 'webp');
    files.push(imgF);
    if (img.length > MAX_PAGE_BYTES) why.push(`${tag}: picture ${img.length} B > 80 KB`);
    if (p.watermark === true) why.push(`${tag}: watermark`);
    const words = cleanWords(p.words);
    let band = null;
    if (p.text_band && (p.text_band.file || p.text_band.cleanFile)) {
      const b = p.text_band.cleanFile ? readBytes(path.join(cleanDir, p.text_band.cleanFile)) : readBytes(path.join(serveDir, p.text_band.file));
      if (b) {
        const bf = fileOf(b, `${tag}-band`, 'webp');
        files.push(bf);
        band = { file: bf.name, w: p.text_band.w, h: p.text_band.h, box: p.text_band.box };
      }
    }
    const isPicture = p.is_picture === true;
    if (!isPicture) {
      if (!words.length || !String(p.text || '').trim()) why.push(`${tag}: no words`);
      if (!band) why.push(`${tag}: no word band`);
      if (p.note && /disagree/i.test(String(p.note))) why.push(`${tag}: reads disagree`);
      const v = voiceDir ? voiceFor({ voiceDir, n: p.n, words, lang, grade: book.grade, voiceGate }) : { why: ['no voice'] };
      if (voiceGate && v.why.length) misses.push({ pageId: pid, n: p.n, why: v.why });
      else v.why.forEach((w) => why.push(`${tag}: ${w}`));
      // A voice that fails any check is not stored: the page is served with no voice (Your turn) until it passes.
      if (v.row && v.file && !v.why.length) {
        // The clip is stored beside the pictures, so the row's audio_key always names a file /s/ can serve.
        files.push(v.file);
        voices.push({ pageId: pid, n: p.n, file: v.file, row: v.row });
      }
    }
    pages.push({
      id: pid, book_id: bookId, n: p.n, image_file: imgF.name, image_w: p.image.w, image_h: p.image.h,
      text: String(p.text || ''), words, text_band: band, lines: cleanLines(p.lines), boxes_ok: p.boxes_ok === true,
      text_source: ['pdf', 'read+boxes', 'read'].includes(p.text_source) ? p.text_source : null,
      confidence: num(p.confidence) != null ? Math.round(p.confidence * 100) / 100 : null, is_picture: isPicture,
      watermark: !pageClear || p.watermark === true,
    });
  }
  if (!pages.length) why.push('no pages');

  const questions = [];
  const questionMisses = [];
  const qv = voiceDir ? readJson(path.join(voiceDir, 'questions.voice.json')) : null;
  const qj = questionsFile ? readJson(questionsFile) : null;
  for (const q of (qj && Array.isArray(qj.questions) ? qj.questions : []).filter((x) => x && x.n >= 1 && x.n <= 5)) {
    let audio = null;
    if (voiceDir) {
      const qa = readBytes(path.join(voiceDir, `q${q.n}.ogg`));
      const os = (q.options || []).map((_, m) => readBytes(path.join(voiceDir, `q${q.n}o${m + 1}.ogg`)));
      // Under the method gate a question's clips are stored only when each one's build record says one natural take;
      // otherwise the question keeps the audio it has (the row is written without its audio column).
      const keys = [qa ? `q${q.n}` : null, ...os.map((b, m) => (b ? `q${q.n}o${m + 1}` : null))].filter(Boolean);
      const qwhy = voiceGate ? keys.flatMap((k) => clipMethodWhy(k, qv && qv.clips ? qv.clips[k] : null)) : [];
      if (qwhy.length) questionMisses.push({ n: q.n, why: qwhy });
      else if (qa || os.some(Boolean)) {
        const qf = qa ? fileOf(qa, `q${q.n}`, 'ogg') : null;
        const ofs = os.map((b, m) => (b ? fileOf(b, `q${q.n}o${m + 1}`, 'ogg') : null));
        [qf, ...ofs].filter(Boolean).forEach((f) => files.push(f));
        audio = { q: qf ? qf.name : null, o: ofs.map((f) => (f ? f.name : null)) };
      }
    }
    questions.push({
      id: Store.uuidV5(bookId, `q${q.n}`), book_id: bookId, n: q.n,
      kind: ['literal', 'inference', 'vocab'].includes(q.kind) ? q.kind : 'literal', q: String(q.q || ''),
      options: (q.options || []).map((o) => (typeof o === 'string' ? { t: o } : o)), answer_i: q.answer_i,
      page_ref: Number.isInteger(q.page_ref) ? q.page_ref : null,
      review_status: ['draft', 'reviewed', 'rejected'].includes(q.review_status) ? q.review_status : 'draft',
      reviewer_note: q.reviewer_note || null, audio,
    });
    if (questionMisses.some((m) => m.n === q.n)) delete questions[questions.length - 1].audio;
  }
  // One file holding every question and option clip, played by time range (one request on a slow line).
  let sprite = null;
  // the sprite joins every clip: one clip that is not a natural take keeps the stored sprite too
  if (!questionMisses.length && qv && qv.sprite && qv.sprite.ogg && qv.sprite.clips) {
    const b = readBytes(path.join(voiceDir, path.basename(qv.sprite.ogg)));
    if (b) { const f = fileOf(b, 'qs', 'ogg'); files.push(f); sprite = { file: f.name, clips: qv.sprite.clips }; }
  }
  const reviewed = questions.filter((q) => q.review_status === 'reviewed').length;
  if (reviewed < 3 || reviewed > 5) why.push(`questions: ${reviewed} reviewed`);

  const textPages = pages.filter((p) => !p.is_picture).length;
  const voiced = voices.length;
  const ms = voices.reduce((a, v) => a + (v.row.ms || 0), 0);
  const bookRow = {
    id: bookId, source_id: book.source_id, slug: book.slug, title: book.title, grade: book.grade, lang,
    slo: extra.slo || book.slo || null, slo_english: book.slo_english || null,
    author: book.author || null, illustrator: book.illustrator || null, pages: pages.length,
    cover_file: cover ? cover.name : null, cover_w: coverSize ? coverSize.w : null, cover_h: coverSize ? coverSize.h : null,
    pdf_r2_key: extra.pdf_r2_key || book.pdf_r2_key || null, questions_sprite: sprite,
    minutes: voiced === textPages && voiced ? Math.round(ms / 6000) / 10 : null,
  };
  if (questionMisses.length) delete bookRow.questions_sprite;
  const uniq = new Map(files.map((f) => [f.name, f]));
  const plan = { bookId, bookRow, pages, voices, questions, files: [...uniq.values()], ready: why.length === 0, why, counts: { pages: pages.length, textPages, voiced, questions: questions.length, reviewed } };
  if (voiceGate) {
    // one voice per book: takes by two voices (or models) in one run are all held back; the pages keep what they have
    const ids = new Set(voices.map((v) => voiceId(v.row)));
    if (ids.size > 1) {
      voices.splice(0).forEach((v) => misses.push({ pageId: v.pageId, n: v.n, why: [`one voice per book: ${ids.size} voices in this run`] }));
      misses.sort((a, b) => a.n - b.n);
      plan.files = plan.files.filter((f) => !/^a\d\d-/.test(f.name) || voices.some((v) => v.file.name === f.name));
      plan.counts.voiced = 0; plan.bookRow.minutes = null;
    }
  }
  return voiceGate ? { ...plan, misses, questionMisses } : plan;
}

/**
 * Store the files and write the rows. store: the interface supabaseStore() implements; upload(buf, {bookId, name,
 * contentType}) → key. dryRun → nothing is written; the same summary comes back.
 */
async function applyPlan(plan, { store, upload, env, dryRun = false, has = null, stored = null }) {
  const out = { bookId: plan.bookId, uploaded: 0, skipped: 0, status: null };
  const keyOf = (name) => Store.storyKey({ env, bookId: plan.bookId, file: name });
  // Under the method gate a page whose new take failed keeps the voice it has; one with none keeps the book a draft.
  // The dry run reads the current voices too (read only), so it gives the write's answer; no store = none kept.
  const seen = plan.misses && plan.misses.length && dryRun ? (store && store.currentVoices ? await store.currentVoices(plan.pages.map((p) => p.id)) : []) : null;
  const split = (cur0) => {
    const lang = plan.bookRow.lang;
    const cur = cur0.filter((c) => !c.lang || !lang || c.lang === lang);
    // a new voice beside a kept page's other voice would make a mixed book: every page keeps the voice it has
    const keptIds = new Set((plan.misses || []).map((m) => cur.find((c) => c.page_id === m.pageId)).filter(Boolean).map(voiceId));
    if (plan.misses && plan.voices.length && keptIds.size && [...keptIds].some((k) => plan.voices.some((v) => voiceId(v.row) !== k))) {
      plan.voices.splice(0).forEach((v) => plan.misses.push({ pageId: v.pageId, n: v.n, why: ['one voice per book: differs from the voice a kept page has'] }));
      plan.misses.sort((a, b) => a.n - b.n);
    }
    const kept = [];
    for (const m of plan.misses || []) {
      if (cur.some((c) => c.page_id === m.pageId)) kept.push(m.n);
      else m.why.forEach((w) => plan.why.push(`p${pad(m.n)}: ${w}`));
    }
    if (plan.misses) { out.kept = kept; plan.ready = plan.ready && plan.why.length === 0; }
    return kept;
  };
  if (dryRun) { if (plan.misses) split(seen || []); out.status = plan.ready ? 'ready' : 'draft'; out.uploaded = plan.files.length; return out; }
  const current = await store.currentVoices(plan.pages.map((p) => p.id));
  const kept = split(current);
  if (plan.misses) {
    // a take held back for one voice per book is never stored either
    const held = new Set(plan.misses.map((m) => m.n));
    plan.files = plan.files.filter((f) => !/^a\d\d-/.test(f.name) || plan.voices.some((v) => v.file.name === f.name && !held.has(v.n)));
  }
  for (const f of plan.files) {
    const key = keyOf(f.name);
    if (has && has(key)) { out.skipped += 1; continue; }
    await upload(f.buf, { bookId: plan.bookId, name: f.name, contentType: f.contentType, key });
    out.uploaded += 1;
  }
  const prior = await store.bookStatus(plan.bookId);
  const bookRow = { ...plan.bookRow };
  if (kept.length) {
    // A kept page still plays: minutes count its stored length; when a length is not known the stored minutes stay.
    const keptMs = kept.map((n) => { const c = current.find((x) => x.page_id === (plan.misses.find((m) => m.n === n) || {}).pageId); return c ? num(c.ms) : null; });
    if (keptMs.every((x) => x) && plan.voices.length + kept.length === plan.counts.textPages) {
      bookRow.minutes = Math.round((plan.voices.reduce((a, v) => a + (v.row.ms || 0), 0) + keptMs.reduce((a, b) => a + b, 0)) / 6000) / 10;
    } else delete bookRow.minutes;
  }
  // A new book is written as a draft first; its status moves only after every row it needs is in.
  await store.upsertBook({ ...bookRow, status: prior || 'draft', updated_at: new Date().toISOString() });
  await store.upsertPages(plan.pages);
  await store.deletePagesAbove(plan.bookId, plan.pages.length ? Math.max(...plan.pages.map((p) => p.n)) : 0);
  for (const v of plan.voices) {
    const audioKey = keyOf(v.file.name);
    const row = { ...v.row, page_id: v.pageId, audio_key: audioKey, is_current: true, id: Store.uuidV5(v.pageId, audioKey) };
    const cur = current.find((c) => c.page_id === v.pageId && c.lang === row.lang);
    if (cur && cur.audio_key !== audioKey) await store.retireVoice(cur.id);
    await store.upsertVoice(row);
  }
  // A page with no passing voice this run keeps no current voice: the reader then offers the child's turn.
  for (const c of current) if (!plan.voices.some((v) => v.pageId === c.page_id) && !(plan.misses || []).some((m) => m.pageId === c.page_id)) await store.retireVoice(c.id);
  // A book is ready only when every voice it names is in storage under story/ (what the picture and voice route serves).
  const missing = [];
  for (const v of plan.voices) {
    const key = keyOf(v.file.name);
    if (!key.startsWith('story/') || (stored && !(await stored(key)))) missing.push(v.n);
  }
  missing.forEach((n) => plan.why.push(`p${pad(n)}: voice clip not stored`));
  await store.upsertQuestions(plan.questions);
  await store.deleteQuestionsAbove(plan.bookId, plan.questions.length ? Math.max(...plan.questions.map((q) => q.n)) : 0);
  const status = prior === 'off' ? 'off' : (plan.ready && !missing.length ? 'ready' : 'draft');
  await store.setStatus(plan.bookId, status);
  out.status = status;
  return out;
}

/** The store interface over a supabase-js client (service role). Every call throws on a database error. */
const BY_ID = { onConflict: 'id' };
function supabaseStore(db) {
  const ok = async (q) => { const { data, error } = await q; if (error) throw new Error(`${error.code || ''} ${error.message}`); return data; };
  return {
    async bookStatus(id) { const r = await ok(db.from('story_books').select('status').eq('id', id).maybeSingle()); return r ? r.status : null; },
    upsertBook: (row) => ok(db.from('story_books').upsert({ ...row }, BY_ID)),
    upsertPages: (rows) => (rows.length ? ok(db.from('story_pages').upsert(rows.map((r) => ({ ...r })), BY_ID)) : null),
    deletePagesAbove: (bookId, n) => ok(db.from('story_pages').delete().eq('book_id', bookId).gt('n', n)),
    currentVoices: async (pageIds) => (pageIds.length ? ok(db.from('story_page_voices').select('id, page_id, lang, audio_key, ms, provider, voice, model').in('page_id', pageIds).eq('is_current', true)) : []),
    retireVoice: (id) => ok(db.from('story_page_voices').update({ is_current: false }).eq('id', id)),
    upsertVoice: (row) => ok(db.from('story_page_voices').upsert({ ...row }, BY_ID)),
    // one upsert per column set: a bulk upsert writes null into a column a row leaves out (a kept question's audio)
    upsertQuestions: async (rows) => {
      const sets = new Map();
      rows.forEach((r) => { const k = Object.keys(r).sort().join(','); sets.set(k, [...(sets.get(k) || []), { ...r }]); });
      let last = null;
      for (const group of sets.values()) last = await ok(db.from('story_questions').upsert(group.map((r) => ({ ...r })), BY_ID));
      return last;
    },
    deleteQuestionsAbove: (bookId, n) => ok(db.from('story_questions').delete().eq('book_id', bookId).gt('n', n)),
    setStatus: (id, status) => ok(db.from('story_books').update({ status, updated_at: new Date().toISOString() }).eq('id', id)),
  };
}

/**
 * The pages children opened while they had no voice yet: the book API logs one row for a page it served with
 * audio:null — story_page_unvoiced, or (before that name existed) story_page_listened with {miss:true}; both are read,
 * so the reader may switch names at any time. → {until, pages:[{book_id, source_id, n}]} (distinct, oldest first), so
 * the voice build can voice exactly those pages and the next load picks them up. Reads only.
 */
async function missedPages(db, { since = null, now = () => new Date() } = {}) {
  const until = now().toISOString();
  const rowsOf = async (shape) => {
    let q = shape(db.from('story_events').select('book_id, page_n, at')).lte('at', until);
    if (since) q = q.gt('at', since);
    const { data, error } = await q.order('at', { ascending: true }).limit(5000);
    if (error) throw new Error(`${error.code || ''} ${error.message}`);
    return data || [];
  };
  const rows = [
    ...(await rowsOf((q) => q.eq('event', 'story_page_unvoiced'))),
    ...(await rowsOf((q) => q.eq('event', 'story_page_listened').eq('data->>miss', 'true'))),
  ].sort((x, y) => (String(x.at) < String(y.at) ? -1 : String(x.at) > String(y.at) ? 1 : 0));
  const seen = new Map();
  for (const r of rows) {
    const k = `${r.book_id}/${r.page_n}`;
    if (r.book_id && Number.isInteger(r.page_n) && !seen.has(k)) seen.set(k, { book_id: r.book_id, n: r.page_n });
  }
  const ids = [...new Set([...seen.values()].map((p) => p.book_id))];
  const src = new Map();
  if (ids.length) {
    const { data: books, error: e2 } = await db.from('story_books').select('id, source_id').in('id', ids);
    if (e2) throw new Error(`${e2.code || ''} ${e2.message}`);
    (books || []).forEach((b) => src.set(b.id, b.source_id));
  }
  return { since, until, pages: [...seen.values()].map((p) => ({ ...p, source_id: src.get(p.book_id) || null })) };
}

/** The method gate's switch, read once per pass: true only when app_settings holds JSON true. A read error throws. */
async function readVoiceGate(db) {
  const { data, error } = await db.from('app_settings').select('key, value').eq('key', VOICE_GATE_KEY).maybeSingle();
  if (error) throw new Error(`${error.code || ''} ${error.message}`);
  return voiceGateOn(data ? data.value : null);
}

module.exports = { readVoiceGate, voiceGateOn, VOICE_GATE_KEY, missedPages, planBook, applyPlan, supabaseStore, voiceFor, cleanWords, webpSize, MAX_PAGE_BYTES, MAX_COVER_BYTES, MAX_WER, MAX_DRIFT_MS };
