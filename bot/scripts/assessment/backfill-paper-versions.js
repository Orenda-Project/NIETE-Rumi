#!/usr/bin/env node
'use strict';
/**
 * Turn every paper edited BEFORE versions existed into two versions.
 *
 *   node bot/scripts/assessment/backfill-paper-versions.js            # dry run (default)
 *   node bot/scripts/assessment/backfill-paper-versions.js --yes --expect-ref <supabase-ref> \
 *        [--render-keys] [--limit N] [--manifest <path.json>]
 *
 * Needs V1.5.6 applied (the edited_from column) and the family-aware browse code
 * deployed first — otherwise the portal lists v1 and v2 side by side.
 *
 * For each ready paper P with edited_at set and edited_from NULL:
 *   1. v1Id = UUIDv5(P.id). Deterministic, so a crash half-way is healed by
 *      running again.
 *   2. The tree P will hold: the full original with her edits swapped in at the
 *      kept paths and every trimmed question flagged removed (see
 *      Selection.reconstructLegacy). Trusted ONLY if it prints byte-identically
 *      to P's stored tree; otherwise P keeps its stored tree ('fallback').
 *   3. v1's PDF: the first file in exams/<user>/<P.id>/ that is neither the
 *      "_Edited" re-render nor an answer key (nothing in the row names it).
 *   4. v1 is inserted from original_exam_json — at attempt+1000 FIRST. The
 *      unique index covers roots only (edited_from IS NULL), and until P is
 *      patched both P and v1 are roots with the same (request_id, attempt), so
 *      inserting v1 at its real attempt fails on the first row.
 *   5. P is patched: edited_from = v1Id, the rebuilt tree, active counts, and a
 *      key only with --render-keys (the key P has was built from the ORIGINAL).
 *   6. v1 gets its real attempt.
 *   Every run starts by healing any v1 left at attempt >= 1000 whose child
 *   already points at it (a crash between 5 and 6).
 *
 * P keeps its id, its file and its status: old WhatsApp messages, portal links
 * and the "_Edited" PDF all point at it. original_exam_json,
 * selected_question_ids and edited_at are left for the later contract migration.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const Selection = require('../../shared/services/assessment/assessment-selection');

/** Fixed namespace for v1 ids. Never change it: it is what makes a re-run idempotent. */
const NAMESPACE = '3f0c7a52-6e1d-5b8a-9c41-7d2e8f0a1b64';
const PAGE = 50;
const TEMP_ATTEMPT = 1000;

/** RFC 4122 name-based (SHA-1) UUID. */
function uuidv5(name, namespace) {
  const ns = Buffer.from(String(namespace).replace(/-/g, ''), 'hex');
  const hash = crypto.createHash('sha1').update(Buffer.concat([ns, Buffer.from(String(name), 'utf8')])).digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function v1IdFor(paperId) {
  return uuidv5(paperId, NAMESPACE);
}

function parseArgs(argv) {
  const a = { yes: false, renderKeys: false, limit: null, manifest: null, expectRef: null };
  for (let i = 0; i < (argv || []).length; i += 1) {
    const x = argv[i];
    if (x === '--yes') a.yes = true;
    else if (x === '--render-keys') a.renderKeys = true;
    else if (x === '--limit') { a.limit = parseInt(argv[i + 1], 10); i += 1; }
    else if (x === '--manifest') { a.manifest = argv[i + 1]; i += 1; }
    else if (x === '--expect-ref') { a.expectRef = argv[i + 1]; i += 1; }
  }
  return a;
}

function refOf(url) {
  const m = String(url || '').match(/^https?:\/\/([a-z0-9]+)\.supabase\.co/i);
  return m ? m[1] : null;
}

function coverage(req) {
  const g = String(req?.grade_code || '').match(/(\d+)/);
  return { grade: g ? Number(g[1]) : null, subject: req?.subject_code || null };
}

const COLUMNS = 'id, request_id, attempt, status, exam_json, original_exam_json, selected_question_ids, '
  + 'question_count, total_marks, file_r2_key, answer_key_r2_key, model, input_tokens, output_tokens, '
  + 'created_at, ready_at, assessment_requests!inner(user_id, grade_code, subject_code, chapter_number, '
  + 'textbook_id, output_format, page_ranges)';

function defaultDeps() {
  return {
    supabase: require('../../shared/config/supabase'),
    r2: require('../../shared/storage/r2'),
    Renderer: require('../../shared/services/assessment/assessment-paper.renderer'),
    rendererFor: require('../../shared/services/assessment/assessment-format').rendererFor,
    log: (...m) => console.log(...m),
    env: process.env,
  };
}

async function must(promise, what) {
  const { data, error } = await promise;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

async function run(argv, injected = {}) {
  // Injected in tests; the real clients otherwise (required lazily so a test
  // never needs Supabase or R2 credentials).
  const d = injected.supabase
    ? { log: () => {}, env: {}, ...injected }
    : { ...defaultDeps(), ...injected };
  const { supabase, r2, log } = d;
  const Renderer = d.Renderer || require('../../shared/services/assessment/assessment-paper.renderer');
  const { fileName } = require('../../shared/services/assessment/assessment-revision.service');
  const args = parseArgs(argv);
  const ref = refOf(d.env?.SUPABASE_URL);

  log(`[backfill-paper-versions] supabase ref: ${ref || '(unknown)'} · ${args.yes ? 'WRITE' : 'dry run'}`
    + `${args.renderKeys ? ' · render keys' : ''}${args.limit ? ` · limit ${args.limit}` : ''}`);
  if (args.yes) {
    if (!args.expectRef) throw new Error('--yes needs --expect-ref <supabase project ref>');
    if (args.expectRef !== ref) throw new Error(`refusing to write: SUPABASE_URL ref is ${ref}, --expect-ref is ${args.expectRef}`);
  }

  const counts = {
    selected: 0, aligned: 0, edit_only: 0, fallback: 0, render_mismatch: 0,
    no_original: 0, no_v1_file: 0, keys_rendered: 0, healed: 0, errors: 0,
  };
  const manifest = { ref, startedAt: new Date().toISOString(), inserted: [], patched: [], modes: {}, errors: [] };

  // Heal: a v1 left at its temporary attempt whose child already points at it.
  if (args.yes) {
    const stuck = await must(supabase.from('assessment_papers').select('id, attempt')
      .is('edited_from', null).gte('attempt', TEMP_ATTEMPT), 'heal lookup');
    for (const v of stuck || []) {
      const child = await must(supabase.from('assessment_papers').select('id').eq('edited_from', v.id).limit(1), 'heal child');
      if (!child || !child.length) continue;
      await must(supabase.from('assessment_papers').update({ attempt: v.attempt - TEMP_ATTEMPT }).eq('id', v.id), 'heal');
      counts.healed += 1;
    }
  }

  const schoolCache = new Map();
  const schoolOf = async (userId) => {
    if (schoolCache.has(userId)) return schoolCache.get(userId);
    let name = null;
    try {
      const u = await must(supabase.from('users').select('school_name').eq('id', userId).maybeSingle(), 'user');
      name = u?.school_name || null;
    } catch { /* the header is cosmetic */ }
    schoolCache.set(userId, name);
    return name;
  };

  let last = null;
  let processed = 0;
  for (;;) {
    let query = supabase.from('assessment_papers').select(COLUMNS)
      .eq('status', 'ready').not('edited_at', 'is', null).is('edited_from', null);
    if (last) query = query.gt('id', last);
    const page = await must(query.order('id').limit(PAGE), 'select');
    if (!page || !page.length) break;

    for (const P of page) {
      last = P.id;
      if (args.limit && processed >= args.limit) break;
      processed += 1;
      counts.selected += 1;
      try {
        const req = P.assessment_requests || {};
        const { grade, subject } = coverage(req);
        const O = P.original_exam_json;
        const E = P.exam_json;
        if (!O) { counts.no_original += 1; manifest.modes[P.id] = 'no_original'; continue; }

        let { tree, mode } = Selection.reconstructLegacy({ original: O, current: E, selectedIds: P.selected_question_ids });
        const renderArgs = { grade, subject, schoolName: null, pageReference: req.page_ranges || null, chapterTitle: null, answerLines: true };
        if (mode !== 'fallback') {
          const rebuilt = Renderer.renderPaper({ ...renderArgs, examJson: Selection.activeTree(tree) });
          const stored = Renderer.renderPaper({ ...renderArgs, examJson: E });
          if (rebuilt !== stored) { counts.render_mismatch += 1; mode = 'fallback'; tree = E; }
        }
        counts[mode] += 1;
        manifest.modes[P.id] = mode;

        const userId = req.user_id;
        const keys = await r2.listKeys(`exams/${userId}/${P.id}/`);
        const v1File = (keys || []).find((k) => !/_Edited/.test(k) && !/_AnswerKey/.test(k)) || null;
        if (!v1File) counts.no_v1_file += 1;

        const origQs = Renderer.collectQuestions(O);
        const origMarks = Renderer.totalMarks(origQs);
        const activeQs = Renderer.collectQuestions(tree);
        const activeMarks = Renderer.totalMarks(activeQs);

        let keyKey = null;
        if (args.renderKeys) {
          const renderer = d.rendererFor(req.output_format || 'pdf');
          const html = Renderer.renderAnswerKey({
            examJson: Selection.activeTree(tree), grade, subject,
            schoolName: await schoolOf(userId), pageReference: req.page_ranges || null, chapterTitle: null,
          });
          if (args.yes) {
            const buffer = await renderer.render(html);
            keyKey = await r2.uploadExamBuffer({
              buffer, userId, examId: P.id,
              filename: fileName({ grade, subject, format: renderer.ext, suffix: '_v2_AnswerKey' }),
            });
            counts.keys_rendered += 1;
          }
        }

        if (!args.yes) continue;

        const v1Id = v1IdFor(P.id);
        await must(supabase.from('assessment_papers').upsert({
          id: v1Id,
          request_id: P.request_id,
          attempt: P.attempt + TEMP_ATTEMPT,
          status: 'ready',
          exam_json: O,
          original_exam_json: O,
          question_count: origQs.length,
          total_marks: Number.isFinite(origMarks) ? origMarks : null,
          file_r2_key: v1File,
          answer_key_r2_key: P.answer_key_r2_key || null,
          model: P.model || null,
          input_tokens: P.input_tokens ?? null,
          output_tokens: P.output_tokens ?? null,
          created_at: P.created_at,
          ready_at: P.ready_at,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id', ignoreDuplicates: true }), 'insert v1');
        manifest.inserted.push(v1Id);

        await must(supabase.from('assessment_papers').update({
          edited_from: v1Id,
          exam_json: tree,
          question_count: activeQs.length,
          total_marks: Number.isFinite(activeMarks) ? activeMarks : null,
          answer_key_r2_key: keyKey,
          updated_at: new Date().toISOString(),
        }).eq('id', P.id).is('edited_from', null), 'patch P');
        manifest.patched.push(P.id);

        await must(supabase.from('assessment_papers').update({ attempt: P.attempt }).eq('id', v1Id), 'v1 attempt');
      } catch (err) {
        counts.errors += 1;
        manifest.errors.push({ id: P.id, error: err.message });
        log(`[backfill-paper-versions] ${P.id} failed: ${err.message}`);
      }
    }
    if (args.limit && processed >= args.limit) break;
  }

  manifest.finishedAt = new Date().toISOString();
  manifest.counts = counts;
  if (args.manifest) {
    fs.mkdirSync(path.dirname(path.resolve(args.manifest)), { recursive: true });
    fs.writeFileSync(args.manifest, JSON.stringify(manifest, null, 2));
  }
  log(`[backfill-paper-versions] ${JSON.stringify(counts)}`);
  return { dryRun: !args.yes, counts, manifest };
}

module.exports = { run, uuidv5, v1IdFor, parseArgs, NAMESPACE };

if (require.main === module) {
  run(process.argv.slice(2))
    .then(({ counts }) => process.exit(counts.errors ? 1 : 0))
    .catch((err) => { console.error(err.message); process.exit(2); });
}
