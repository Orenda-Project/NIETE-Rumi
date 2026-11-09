// KNOWN DESIGN DEBT (Nov 2026): lesson plans are spread over ~20 tables, one set per product generation
// (K-5 v8/v9, 6-12, GB, legacy). Do NOT add another per-region or per-generation LP table, cache or env
// flag: extend the existing table with the book as the separator, say so in the PR, and ask the operator
// (Hataf) before any new LP table.
// Why, target model, follow-up (bd-42mo0w, audit planned): docs/lesson-plan-data-model-debt.md
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
 * Dependencies are injected (createOwnWorker) so the rules are testable without an LLM, Chromium, R2 or Supabase.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const { buildOwnInstruction } = require('../shared/services/lp612-own-instruction');

const OWN_TABLE = 'niete_lp612_own_plans';
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

  async function waitForParent(row, correlationId) {
    const until = d.now() + (d.parentWaitMs ?? PARENT_WAIT_MS);
    for (;;) {
      const doc = await d.readStoredDoc({ segmentId: row.segment_id, lang: row.lang, tv: row.template_version, correlationId });
      if (doc) return doc;
      if (d.now() >= until) return null;
      await d.sleep(d.pollMs ?? PARENT_POLL_MS);
    }
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

  async function process(payload = {}) {
    const { ownId, correlationId = null } = payload;
    const row = await d.claimOwn(ownId);
    if (!row) return;

    try {
      const segment = await d.loadSegment(row.segment_id);
      if (!segment) throw stop('NO_SEGMENT', 'segment not in the catalogue');

      const parent = await waitForParent(row, correlationId);
      if (!parent) throw stop('NO_PARENT', 'the shared lesson was not written in time');

      const instruction = buildOwnInstruction(row.answers);
      const out = await d.revise({ doc: parent, instruction, segment, lang: row.lang, correlationId });
      if (!out || !out.accepted) throw stop('NOT_ACCEPTED', 'the gates rejected the rewrite');

      const pdf = await renderPdf(out.lpDoc, row, correlationId);

      const K = keys();
      const hash = K.editHash({ instruction, doc: parent });
      const at = { segmentId: row.segment_id, lang: row.lang, tv: row.template_version, hash };
      const pdfKey = K.assertKeyInPrefix(K.editKeyFor(at));
      await d.upload(pdf, pdfKey, 'application/pdf');
      try {
        await d.upload(
          Buffer.from(JSON.stringify(out.lpDoc, null, 1), 'utf8'),
          K.assertKeyInPrefix(K.editKeyFor({ ...at, ext: 'lp.json' })),
          'application/json',
        );
      } catch (err) {
        // The PDF is the product; the document beside it is for us (the author worker's rule).
        d.log('LP 6-12 own: could not store the document', { ownId, error: err.message, correlationId });
      }

      await d.patchOwn(row.id, {
        status: 'ready', r2_key: pdfKey, edit_hash: hash, model_used: out.model || null,
        error_code: null, error_detail: null, completed_at: new Date().toISOString(),
      });
    } catch (e) {
      d.log('LP 6-12 own: could not make her plan', { ownId, code: e.code || null, error: e.message, correlationId });
      await d.patchOwn(row.id, {
        status: 'failed', error_code: e.code || 'OWN_FAILED', error_detail: String(e.message || '').slice(0, 500),
        completed_at: new Date().toISOString(),
      });
    }
  }

  return { process };
}

/** The segment row, or null (the author worker's loadSegment, in the shape the schema guards read). */
async function loadSegment(supabase, segmentId) {
  const { data, error } = await supabase
    .from('niete_lp612_segments')
    .select('*')
    .eq('segment_id', segmentId)
    .maybeSingle();
  return error ? null : (data || null);
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
        .select('id, user_id, segment_id, lang, template_version, status, answers')
        .maybeSingle();
      if (error) logToFile('LP 6-12 own: claim failed', { ownId: id, error: error.message });
      return error ? null : data;
    },
    loadSegment: (segmentId) => loadSegment(supabase, segmentId),
    readStoredDoc: (args) => Serving.readStoredDoc(args),
    revise: (args) => require('../shared/services/lp612-author.service').reviseLessonPlan(args),
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
  };
}

let live = null;

module.exports = {
  createOwnWorker,
  process: (payload) => { live = live || createOwnWorker(liveDeps()); return live.process(payload); },
  PARENT_WAIT_MS,
};
