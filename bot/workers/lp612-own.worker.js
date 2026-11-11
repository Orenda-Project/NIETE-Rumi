// KNOWN DESIGN DEBT (Nov 2026): lesson plans are spread over ~20 tables, one set per product generation
// (K-5 v8/v9, 6-12, GB, legacy). Do NOT add another per-region or per-generation LP table, cache or env
// flag: extend the existing table with the book as the separator, say so in the PR, and ask the operator
// (Hataf) before any new LP table.
// Why, target model, follow-up (audit planned): docs/lesson-plan-data-model-debt.md
/**
 * bd-snkn32 — the "Make my own" job (jobType lp612_own, queued by lp612-own.service).
 *
 *   her row → the shared English document (waiting for it while it is written) → her answers as ONE instruction →
 *   reviseLessonPlan (the existing edit lane: page-truth kept, gates run, her original returned on any rejection) →
 *   render → her FORK under lp612/{tv}/en/edits/{segment}/{hash}.pdf (+ .lp.json) → her row ready.
 *
 * WHAT IT NEVER DOES: write the shared document or its key (only editKeyFor's edits/ path is put, through
 * assertKeyInPrefix), or store a rewrite the gates rejected. Every failure ends her row `failed` with a reason, so the
 * portal's waiting page says "Couldn't make it" instead of waiting forever. It never throws to the queue: a retry
 * would only pay for the same rejection again.
 *
 * GRADES 1–5 (bd-snkn32.4): a row with `lesson_id` → that day's own stored plan (its slide script, in its book's
 * language) → her answers, ONE rewrite (lp-k5-own-author: gated, one repair round) → printed as a phone page in the v10
 * card's look → her fork under lp612/own-k5/{lang}/{lesson}/{hash}.pdf (+ .json) → her row ready. Nothing shared is
 * written; the key stays in the lp612/ prefix.
 *
 * CHANGES (bd-snkn32.15): a row with `parent_own_id` is one of her two changes. It starts from her latest READY plan
 * in the chain (the document stored beside that plan's PDF), never the shared plan, and its instruction is her one
 * change (lp-own-edit-instruction), not her class answers. Same rewrite, gates, keys and status as a make.
 *
 * Dependencies are injected (createOwnWorker) so the rules are testable without an LLM, Chromium, R2 or Supabase.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const { buildOwnInstruction } = require('../shared/services/lp612-own-instruction');
const { bookRange } = require('../shared/services/lp612-own-pages'); // item 14
const { buildEditInstruction } = require('../shared/services/lp-own-edit-instruction');
const { editBase, baseJsonKey, bandOf } = require('../shared/services/lp-own-edit-guard');
const Extend = require('../shared/services/lp612-own-extend');

/** A shared lesson takes a median of ~3 min and up to ~10 to write; her fork waits that long for it, then gives up. */
const PARENT_WAIT_MS = 12 * 60 * 1000;
const PARENT_POLL_MS = 20 * 1000;

/** Long, not broken: every problem is page count and the PDF exists (the author worker's bd-vjk68 rule). */
function longOnly(e) {
  return !!e && e.infra === false && !!e.pdfPath && Array.isArray(e.problems) && e.problems.length > 0
    && e.problems.every((p) => String(p).startsWith('PAGE COUNT'));
}

function stop(code, message) {
  return Object.assign(new Error(message), { code });
}

function createOwnWorker(deps) {
  const d = deps;
  const keys = () => d.keys || require('../shared/services/lp612-serving.service');
  /** her book's page text for the rewrite; never fails her plan (no reader, a throw → no text). */
  const textOf = async (q) => { try { return d.bookText ? (await d.bookText(q)) || null : null; } catch (_) { return null; } };

  /**
   * bd-snkn32.14 — "Add the next lesson's pages": the next lesson is re-checked against the catalogue (adjacent, same
   * chapter), its shared plan waited for like hers, and the rewrite gets the joined segment + both plans + the shape.
   * A change (bd-snkn32.15) keeps the joined pages only: its base, her last plan, already holds both lessons.
   */
  async function joinNext(row, segment, instruction, correlationId) {
    const ext = row.answers && row.answers.extend;
    if (!ext) return { segment, instruction };
    const rows = await d.chapterSegments(segment);
    const next = Extend.nextInChapter(segment, rows);
    if (!next || next.segment_id !== ext.next) throw stop('BAD_EXTEND', 'the next lesson is not the adjacent one in this chapter');
    if (row.parent_own_id) return { segment: Extend.joinSegments(segment, next, ext.shape), instruction };
    const nextDoc = await waitForParent({ ...row, segment_id: next.segment_id }, correlationId);
    if (!nextDoc) throw stop('NO_PARENT', 'the next lesson was not written in time');
    return {
      segment: Extend.joinSegments(segment, next, ext.shape),
      instruction: `${instruction}\n${Extend.buildExtendInstruction({ first: segment, next, nextDoc, shape: ext.shape })}`,
    };
  }

  async function waitForParent(row, correlationId) {
    const until = d.now() + (d.parentWaitMs ?? PARENT_WAIT_MS);
    for (;;) {
      const doc = await d.readStoredDoc({ segmentId: row.segment_id, lang: row.lang, tv: row.template_version, correlationId });
      if (doc) return doc;
      if (d.now() >= until) return null;
      await d.sleep(d.pollMs ?? PARENT_POLL_MS);
    }
  }

  /** bd-snkn32.15 — a change starts from her latest ready plan in the chain (never itself): its stored document. */
  async function changeBase(row) {
    const chain = await d.listChain(row.parent_own_id, row.user_id);
    const base = editBase((chain || []).filter((r) => r && r.id !== row.id));
    const key = base && baseJsonKey(base.r2_key, bandOf(row));
    const doc = key ? await d.readJson(key) : null;
    if (!doc) throw stop('NO_PARENT', 'her last ready plan has no stored document to change');
    return doc;
  }

  async function renderPdf(lpDoc, row, correlationId) {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-own-'));
    try {
      const out = await d.render({
        lpDoc, lang: row.lang, stem: `own_${row.id}`, outDir, correlationId, segmentId: row.segment_id, phase: 'final',
      });
      return await d.readFile(out.pdfPath);
    } catch (e) {
      if (longOnly(e)) return d.readFile(e.pdfPath);
      throw stop('RENDER_FAILED', (e && e.message) || 'render failed');
    } finally {
      fs.rm(outDir, { recursive: true, force: true }, () => {});
    }
  }

  /** bd-snkn32.4 — a grades 1–5 day. Throws stop(...) on every failure, like the 6-12 path. */
  async function processK5(row, correlationId, startFrom) {
    const day = await d.loadK5(row.lesson_id);
    if (!day) throw stop('NO_PARENT', 'the day has no stored plan to start from');
    const script = startFrom || day.script; // bd-snkn32.15: a change rewrites her latest plan; the day gives its meta
    // bd-snkn32.12 — the gradual release is never dropped: a parent without every part is not a day to rewrite.
    const missing = require('../shared/services/lp-k5-own').missingGrr(script);
    if (missing.length) throw stop('INCOMPLETE_PARENT', `the day's plan has no ${missing.join(', ')}`);
    const pg = (row.answers && row.answers.pages) || day.pages || {};
    const bookText = await textOf({ grade: day.grade, subject: day.subject, from: pg.start, to: pg.end });
    const out = await d.rewriteK5({
      script, answers: row.answers, edit: row.edit_request || undefined, lang: day.lang, grade: day.grade, subject: day.subject, dayPages: day.pages || null, bookText, correlationId,
    });
    if (!out || !out.script) throw stop('NOT_ACCEPTED', 'the gate refused the rewrite');
    let pdf;
    try {
      pdf = await d.renderK5({ script: out.script, lang: day.lang, grade: day.grade, subject: day.subjectName, way: row.answers && (row.answers.ways || row.answers.way), pages: (row.answers && row.answers.pages) || day.pages || null });
    } catch (e) {
      throw stop('RENDER_FAILED', (e && e.message) || 'print failed');
    }
    const hash = require('crypto').createHash('sha256')
      .update(JSON.stringify({ a: row.answers, s: out.script, e: row.edit_request || undefined })).digest('hex').slice(0, 16);
    const base = `lp612/own-k5/${day.lang}/${row.lesson_id}/${hash}`;
    const pdfKey = keys().assertKeyInPrefix(`${base}.pdf`);
    await d.upload(pdf, pdfKey, 'application/pdf');
    try {
      await d.upload(Buffer.from(JSON.stringify(out.script, null, 1), 'utf8'), keys().assertKeyInPrefix(`${base}.json`), 'application/json');
    } catch (err) {
      d.log('LP K-5 own: could not store the script', { ownId: row.id, error: err.message, correlationId });
    }
    await d.patchOwn(row.id, {
      status: 'ready', r2_key: pdfKey, edit_hash: hash, model_used: out.model || null,
      error_code: null, error_detail: null, completed_at: new Date().toISOString(),
    });
  }

  /** Her row is already ready: the AI reviewer scores it for the library only, and never fails her. */
  async function reviewAfterReady(row, correlationId) {
    if (!d.review) return;
    try {
      await d.review(row.id, correlationId);
    } catch (err) {
      d.log('LP own review: failed after ready', { ownId: row.id, error: err.message, correlationId });
    }
  }

  async function process(payload = {}) {
    const { ownId, correlationId = null } = payload;
    const row = await d.claimOwn(ownId);
    if (!row) return;
    if (await make(row, ownId, correlationId)) await reviewAfterReady(row, correlationId);
  }

  /** true when her row ended ready. */
  async function make(row, ownId, correlationId) {
    try {
      const base = row.parent_own_id ? await changeBase(row) : null;
      if (row.lesson_id) { await processK5(row, correlationId, base); return true; }

      const segment = await d.loadSegment(row.segment_id);
      if (!segment) throw stop('NO_SEGMENT', 'segment not in the catalogue');

      const parent = base || await waitForParent(row, correlationId);
      if (!parent) throw stop('NO_PARENT', 'the shared lesson was not written in time');

      const own = row.parent_own_id ? buildEditInstruction(row.edit_request) // bd-snkn32.15: her one change
        : buildOwnInstruction(row.answers, { grade: segment.grade, segmentId: row.segment_id, // 
          bookText: await textOf({ grade: segment.grade, subject: segment.subject, ...bookRange(row.answers, segment), curriculum: segment.curriculum }) });
      const joined = await joinNext(row, segment, own, correlationId); // bd-snkn32.14
      const { instruction } = joined;
      const out = await d.revise({ doc: parent, instruction, segment: joined.segment, lang: row.lang, correlationId });
      if (!out || !out.accepted) throw stop('NOT_ACCEPTED', 'the gates rejected the rewrite');
      const lost = require('../shared/services/lp612-own-grr').droppedGrr(parent, out.lpDoc); // GRR stays
      if (lost.length) throw stop('GRR_DROPPED', `the rewrite dropped ${lost.join(', ')}`);

      const pdf = await renderPdf(out.lpDoc, row, correlationId);

      const K = keys();
      const hash = K.editHash({ instruction, doc: parent });
      const at = { segmentId: row.segment_id, lang: row.lang, tv: row.template_version, hash };
      const pdfKey = K.assertKeyInPrefix(K.editKeyFor(at));
      await d.upload(pdf, pdfKey, 'application/pdf');
      try {
        await d.upload(Buffer.from(JSON.stringify(out.lpDoc, null, 1), 'utf8'), K.assertKeyInPrefix(K.editKeyFor({ ...at, ext: 'lp.json' })), 'application/json');
      } catch (err) {
        // The PDF is the product; the document beside it is for us (the author worker's rule).
        d.log('LP 6-12 own: could not store the document', { ownId, error: err.message, correlationId });
      }

      await d.patchOwn(row.id, {
        status: 'ready', r2_key: pdfKey, edit_hash: hash, model_used: out.model || null,
        error_code: null, error_detail: null, completed_at: new Date().toISOString(),
      });
      return true;
    } catch (e) {
      d.log('LP 6-12 own: could not make her plan', { ownId, code: e.code || null, error: e.message, correlationId });
      await d.patchOwn(row.id, {
        status: 'failed', error_code: e.code || 'OWN_FAILED', error_detail: String(e.message || '').slice(0, 500),
        completed_at: new Date().toISOString(),
      });
      return false;
    }
  }

  return { process };
}

/** The segment row, or null (the author worker's loadSegment, in the shape the schema guards read). */
async function loadSegment(supabase, segmentId) {
  const { data, error } = await supabase.from('niete_lp612_segments').select('*').eq('segment_id', segmentId).maybeSingle();
  return error ? null : (data || null);
}

/** bd-snkn32.4 — the page (pure) printed by the v10 card's printer: one 520-wide page, as long as the plan. */
async function renderK5Pdf({ script, lang, grade, subject, way, pages }) {
  const { renderK5Own, WAY_NAMES } = require('../shared/services/lp-k5-own-render');
  const { fontCss } = require('../shared/services/lp-k5-own-fonts');
  const html = renderK5Own(script, { lang, grade, subject, way: [].concat(way || []).map((k) => (WAY_NAMES[lang] || WAY_NAMES.en)[k]).filter(Boolean).join(lang === 'ur' ? '، ' : ', ') || undefined, pages, fontCss: fontCss(lang) });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'k5-own-'));
  try {
    const out = path.join(dir, 'own.pdf');
    await require('../shared/services/lp-v10-card/print').printCard(html, out);
    return await fs.promises.readFile(out);
  } finally {
    fs.rm(dir, { recursive: true, force: true }, () => {});
  }
}

function liveDeps() {
  const supabase = require('../shared/config/supabase');
  const { logToFile } = require('../shared/utils/logger');
  const Serving = require('../shared/services/lp612-serving.service');
  return {
    keys: Serving,
    claimOwn: async (id) => {
      if (!id) return null;
      const { data, error } = await supabase
        .from('niete_lp612_own_plans')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', id).eq('status', 'authoring')
        .select('id, user_id, segment_id, lesson_id, lang, template_version, status, answers, parent_own_id, edit_round, edit_request')
        .maybeSingle();
      if (error) logToFile('LP 6-12 own: claim failed', { ownId: id, error: error.message });
      return error ? null : data;
    },
    loadSegment: (segmentId) => loadSegment(supabase, segmentId),
    listChain: (rootId, userId) => require('../shared/services/lp612-own.service').listChain(supabase, rootId, userId),
    readJson: async (key) => {
      try {
        return JSON.parse((await require('../shared/storage/r2').downloadFromR2(key)).toString('utf8'));
      } catch (err) {
        logToFile('LP own change: could not read her last plan', { key, error: err.message });
        return null;
      }
    },
    chapterSegments: (seg) => require('../shared/services/lp612-own-extend.store').chapterSegments(supabase, seg),
    readStoredDoc: (args) => Serving.readStoredDoc(args),
    revise: (args) => require('../shared/services/lp612-author.service').reviseLessonPlan(args),
    loadK5: (lessonId) => require('../shared/services/lp-k5-own-source').loadK5(lessonId),
    bookText: (q) => require('../shared/services/lp-own-book').bookTextFor(q),
    rewriteK5: (args) => require('../shared/services/lp-k5-own-author').rewriteK5({ ...args, log: (m, x) => logToFile(m, x) }),
    renderK5: (args) => renderK5Pdf(args),
    render: (args) => require('../shared/services/lp612-render.service').renderLessonPlan(args),
    readFile: (p) => fs.promises.readFile(p),
    upload: (buf, key, type) => require('../shared/storage/r2').uploadBuffer(buf, key, type),
    patchOwn: async (id, fields) => {
      const { error } = await supabase.from('niete_lp612_own_plans').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) logToFile('LP 6-12 own: row update failed', { ownId: id, error: error.message });
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    log: (msg, meta) => logToFile(msg, meta),
    review: (id, correlationId) => require('../shared/services/lp612-own-reviewer').review(id, correlationId),
  };
}

let live = null;

module.exports = {
  createOwnWorker,
  process: (payload) => { live = live || createOwnWorker(liveDeps()); return live.process(payload); },
  PARENT_WAIT_MS,
};
