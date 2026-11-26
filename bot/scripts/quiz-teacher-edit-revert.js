#!/usr/bin/env node
'use strict';
/**
 * Undo a teacher's quiz edit (quiz-teacher-edit.js) from its audit, quiz_teacher_edits.
 *
 *   node scripts/quiz-teacher-edit-revert.js --quiz <quiz id> [--edit-v N] [--apply]
 *
 * DRY RUN by default: prints what would change. --apply replays the version's `before` values through the same save
 * function (quiz_teacher_edit_apply, edited_by 'revert'): one transaction, the rows checked against what they are now,
 * the PDF dropped and then remade, the clips re-recorded on the next Play. A removed question comes back whole, with
 * its id. Only the quiz's LATEST version can be reverted (run it again for the one before); a version that is itself
 * a revert is not. Answers recorded meanwhile keep their mark, as they do for the edit itself.
 */
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseArgs(argv) {
  const out = { quiz: null, editV: null, apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--quiz') out.quiz = argv[i += 1];
    else if (argv[i] === '--edit-v') out.editV = Number(argv[i += 1]);
    else if (argv[i] === '--apply') out.apply = true;
  }
  if (!UUID_RX.test(String(out.quiz || ''))) throw new Error('--quiz <quiz id> is required');
  if (out.editV !== null && !(Number.isInteger(out.editV) && out.editV >= 1)) throw new Error('--edit-v must be a version number');
  return out;
}

/** The save function's changes that undo version `editV`. Pure. */
function revertChanges({ audit, editV, currentEditV, rowsById }) {
  const { editCols } = require('../shared/services/quiz/quiz-teacher-edit');
  if (editV !== currentEditV) return { ok: false, reason: 'not_latest', currentEditV };
  const rows = (audit || []).filter((a) => a.edit_v === editV && a.edited_by === 'teacher');
  if (!rows.length) return { ok: false, reason: 'no_teacher_edit' };
  const byQ = new Map();
  rows.forEach((a) => { if (!byQ.has(a.question_id)) byQ.set(a.question_id, []); byQ.get(a.question_id).push(a); });
  const changes = [];
  for (const [id, list] of byQ) {
    const rm = list.find((a) => a.field === 'remove');
    if (rm) {
      changes.push({ id, insert: rm.before.row, fields: [{ field: 'remove', before: null, after: { value: 'restored' } }] });
      continue;
    }
    const now = rowsById.get(id);
    if (!now) return { ok: false, reason: 'row_gone', qid: id };
    const before = editCols(now);
    const was = list[0].before.row;
    changes.push({
      id, remove: false, before, after: was,
      fields: list.map((a) => ({ field: a.field, before: { value: a.after ? a.after.value : null }, after: { value: a.before.value } })),
    });
  }
  return { ok: true, changes };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const supabase = require('../shared/config/supabase');
  const Edit = require('../shared/services/quiz/quiz-teacher-edit');
  const { data: quiz, error } = await supabase.from('quizzes').select('id, meta').eq('id', args.quiz).maybeSingle();
  if (error || !quiz) throw new Error(`quiz not readable: ${error ? error.message : 'not found'}`);
  const currentEditV = Number((quiz.meta || {}).edit_v) || 0;
  const editV = args.editV || currentEditV;
  const { data: audit, error: aErr } = await supabase.from('quiz_teacher_edits').select('*').eq('quiz_id', args.quiz).eq('edit_v', editV);
  if (aErr) throw new Error(`audit not readable: ${aErr.message}`);
  const { data: rows, error: rErr } = await supabase.from('quiz_questions').select('*').eq('quiz_id', args.quiz);
  if (rErr) throw new Error(`rows not readable: ${rErr.message}`);
  const r = revertChanges({ audit, editV, currentEditV, rowsById: new Map((rows || []).map((x) => [x.id, x])) });
  console.log(JSON.stringify({ quiz: args.quiz, edit_v: editV, ...r, changes: r.changes && r.changes.map((c) => ({ id: c.id, fields: c.fields.map((f) => f.field), insert: Boolean(c.insert) })) }, null, 2));
  if (!r.ok || !args.apply) return r.ok ? 0 : 1;
  const { data, error: e } = await supabase.rpc('quiz_teacher_edit_apply', {
    p_quiz_id: args.quiz, p_teacher_id: null, p_expect_v: currentEditV, p_changes: r.changes, p_min: 0, p_editor: 'revert',
  });
  if (e || !data || !data.ok) { console.error('REVERT REFUSED', e ? e.message : JSON.stringify(data)); return 1; }
  const pdf = await Edit.remakePdf(args.quiz, data.edit_v);
  console.log(`REVERTED edit ${editV} → now edit ${data.edit_v}, ${data.n} questions, pdf ${pdf}`);
  return 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = { parseArgs, revertChanges, main };
